// app/api/admin/events/[id]/export/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getRainEventById } from "@/app/lib/eventsRepoServer";

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    if (value == null) return "";
    const s = String(value);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];

  return lines.join("\n");
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const eventId = Number(id);

  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ ok: false, error: "Invalid event id" }, { status: 400 });
  }

  const event = await getRainEventById(eventId);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }

  const endIso = event.ended_at ?? new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("sensor_readings")
    .select("*")
    .eq("device_id", event.device_id)
    .gte("ts", event.started_at)
    .lte("ts", endIso)
    .order("ts", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: `[export event] ${error.message}` },
      { status: 500 }
    );
  }

  const csv = toCsv((data ?? []) as Record<string, unknown>[]);

  const filename = `rain-event-${event.id}-${event.device_id}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}