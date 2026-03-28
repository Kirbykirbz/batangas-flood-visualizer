import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function csvEscape(value: unknown) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );

  const headerLine = headers.map(csvEscape).join(",");

  const bodyLines = rows.map((row) =>
    headers.map((header) => csvEscape(row[header])).join(",")
  );

  return [headerLine, ...bodyLines].join("\n");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const eventId = Number(id);

    if (!Number.isFinite(eventId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid event id" },
        { status: 400 }
      );
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("rain_events")
      .select(
        `
          id,
          device_id,
          started_at,
          ended_at,
          status
        `
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      throw new Error(`[GET /api/events/${eventId}/export:event] ${eventError.message}`);
    }

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Rain event not found" },
        { status: 404 }
      );
    }

    const startedAt = event.started_at;
    const endedAt = event.ended_at ?? new Date().toISOString();

    const { data: readings, error: readingsError } = await supabaseAdmin
      .from("sensor_readings")
      .select("*")
      .eq("device_id", event.device_id)
      .gte("created_at", startedAt)
      .lte("created_at", endedAt)
      .order("created_at", { ascending: true });

    if (readingsError) {
      throw new Error(
        `[GET /api/events/${eventId}/export:readings] ${readingsError.message}`
      );
    }

    const csv = rowsToCsv(readings ?? []);

    const filename = `rain-event-${eventId}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/events/[id]/export] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to export event CSV",
      },
      { status: 500 }
    );
  }
}