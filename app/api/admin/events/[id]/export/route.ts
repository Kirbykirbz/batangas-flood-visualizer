import { NextResponse } from "next/server";
import { getRainEventById } from "@/app/lib/eventsRepoServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { toNumber } from "@/app/lib/sensorReading";

type SensorReadingRow = {
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

function csvEscape(value: unknown) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function boolText(value: boolean | null | undefined) {
  if (value == null) return "";
  return value ? "true" : "false";
}

function rowsToCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(csvEscape).join(",");

  const bodyLines = rows.map((row) =>
    headers.map((header) => csvEscape(row[header])).join(",")
  );

  return [headerLine, ...bodyLines].join("\n");
}

function extractDeltaTips(
  current: SensorReadingRow,
  previous: SensorReadingRow | null
): number {
  const currTicks = toNumber(current.rain_ticks_total);
  const prevTicks = previous ? toNumber(previous.rain_ticks_total) : null;

  if (currTicks == null || prevTicks == null) return 0;

  const delta = currTicks - prevTicks;
  if (!Number.isFinite(delta) || delta <= 0) return 0;

  return delta;
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

    const event = await getRainEventById(eventId);

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Rain event not found" },
        { status: 404 }
      );
    }

    const endIso = event.ended_at ?? new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sensor_readings")
      .select(
        `
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
        `
      )
      .eq("device_id", event.device_id)
      .gte("ts", event.started_at)
      .lte("ts", endIso)
      .order("ts", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: `[event export] ${error.message}` },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as SensorReadingRow[];

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No sensor readings found for this event window" },
        { status: 404 }
      );
    }

    let runningTips = 0;
    let runningRainMm = 0;

    const exportRows = rows.map((row, index) => {
      const previous = index > 0 ? rows[index - 1] : null;
      const deltaTips = extractDeltaTips(row, previous);

      runningTips += deltaTips;
      runningRainMm += deltaTips * 0.27;

      return {
        event_id: event.id,
        event_status: event.status,
        event_started_at: event.started_at,
        event_ended_at: event.ended_at ?? "",
        event_trigger_reason: event.trigger_reason ?? "",
        event_ended_reason: event.ended_reason ?? "",

        sensor_id: row.device_id,
        reading_id: row.id,
        reading_ts: row.ts,
        reading_created_at: row.created_at,

        raw_dist_cm: toNumber(row.raw_dist_cm),
        raw_water_cm: toNumber(row.raw_water_cm),
        stable_water_cm: toNumber(row.stable_water_cm),
        flood_depth_cm: toNumber(row.flood_depth_cm),
        dry_distance_cm: toNumber(row.dry_distance_cm),

        us_valid: boolText(row.us_valid),
        accepted_for_stable: boolText(row.accepted_for_stable),
        overflow: boolText(row.overflow),

        rain_ticks_total: toNumber(row.rain_ticks_total),
        delta_tips_from_previous: deltaTips,
        cumulative_event_tips: runningTips,

        tips_60: toNumber(row.tips_60),
        tips_300: toNumber(row.tips_300),

        rain_rate_mmh_60: toNumber(row.rain_rate_mmh_60),
        rain_rate_mmh_300: toNumber(row.rain_rate_mmh_300),

        cumulative_event_rain_mm: Number(runningRainMm.toFixed(3)),

        rssi_dbm: toNumber(row.rssi_dbm),
        vbat_v: toNumber(row.vbat_v),
        current_ma: toNumber(row.current_ma),
        battery_percentage: toNumber(row.battery_percentage),
        network_type: row.network_type ?? "",
      };
    });

    const csv = rowsToCsv(exportRows);
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
    console.error("[GET /api/admin/events/[id]/export] failed:", error);

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