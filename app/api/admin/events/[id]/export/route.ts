import { NextResponse } from "next/server";
import { getRainEventById } from "@/app/lib/eventsRepoServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type SensorReadingExportRow = {
  id: number;
  device_id: string;
  ts: string;
  raw_dist_cm: number | null;
  raw_water_cm: number | null;
  stable_water_cm: number | null;
  us_valid: boolean;
  accepted_for_stable: boolean;
  overflow: boolean;
  rain_ticks_total: number | null;
  tips_60: number | null;
  tips_300: number | null;
  rain_rate_mmh_60: number | null;
  rain_rate_mmh_300: number | null;
  rssi_dbm: number | null;
  flood_depth_cm: number | null;
  dry_distance_cm: number | null;
  created_at: string;
  vbat_v: number | null;
  current_ma: number | null;
  battery_percentage: number | null;
  network_type: string | null;
};

function escapeCsv(value: unknown): string {
  if (value == null) return "";

  const str = String(value);

  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function rowsToCsv(rows: SensorReadingExportRow[]): string {
  const headers: Array<keyof SensorReadingExportRow> = [
    "id",
    "device_id",
    "ts",
    "raw_dist_cm",
    "raw_water_cm",
    "stable_water_cm",
    "us_valid",
    "accepted_for_stable",
    "overflow",
    "rain_ticks_total",
    "tips_60",
    "tips_300",
    "rain_rate_mmh_60",
    "rain_rate_mmh_300",
    "rssi_dbm",
    "flood_depth_cm",
    "dry_distance_cm",
    "created_at",
    "vbat_v",
    "current_ma",
    "battery_percentage",
    "network_type",
  ];

  const lines: string[] = [];
  lines.push(headers.join(","));

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(","));
  }

  return lines.join("\n");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const eventId = Number(id);

  if (!Number.isFinite(eventId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid event id" },
      { status: 400 }
    );
  }

  try {
    const event = await getRainEventById(eventId);

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Event not found" },
        { status: 404 }
      );
    }

    const endIso = event.ended_at ?? new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sensor_readings")
      .select(`
        id,
        device_id,
        ts,
        raw_dist_cm,
        raw_water_cm,
        stable_water_cm,
        us_valid,
        accepted_for_stable,
        overflow,
        rain_ticks_total,
        tips_60,
        tips_300,
        rain_rate_mmh_60,
        rain_rate_mmh_300,
        rssi_dbm,
        flood_depth_cm,
        dry_distance_cm,
        created_at,
        vbat_v,
        current_ma,
        battery_percentage,
        network_type
      `)
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

    const rows = (data ?? []) as SensorReadingExportRow[];
    const csv = rowsToCsv(rows);

    const safeDeviceId = event.device_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `rain-event-${event.id}-${safeDeviceId}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to export event CSV",
      },
      { status: 500 }
    );
  }
}