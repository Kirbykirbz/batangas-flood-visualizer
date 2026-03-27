import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  createRainEvent,
  getOngoingRainEvent,
  updateRainEvent,
} from "@/app/lib/eventsRepoServer";
import { toNumber } from "@/app/lib/sensorReading";

const MM_PER_TIP = 0.27;
const EVENT_START_RAIN_MMHR = 0.5;
const EVENT_START_DEPTH_CM = 5;

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

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function extractRainMmHr(row: SensorReadingRow): number {
  return (
    toNumber(row.rain_rate_mmh_300) ??
    toNumber(row.rain_rate_mmh_60) ??
    0
  );
}

function extractFloodDepthCm(row: SensorReadingRow): number {
  return toNumber(row.flood_depth_cm) ?? 0;
}

function extractTips60(row: SensorReadingRow): number {
  return toNumber(row.tips_60) ?? 0;
}

function computeTriggerReason(first: SensorReadingRow): string {
  const rainMmHr = extractRainMmHr(first);
  const depthCm = extractFloodDepthCm(first);
  const tips60 = extractTips60(first);
  const overflow = first.overflow === true;

  if (overflow) return "overflow detected";

  if (
    depthCm >= EVENT_START_DEPTH_CM &&
    (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0)
  ) {
    return "rainfall and flood depth threshold met";
  }

  if (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0) {
    return "rainfall threshold met";
  }

  if (depthCm >= EVENT_START_DEPTH_CM) {
    return "flood depth threshold met";
  }

  return "manual event created from sensor readings";
}

function computeTotalRainMm(rows: SensorReadingRow[]): number {
  if (rows.length < 2) return 0;

  let total = 0;

  for (let i = 1; i < rows.length; i++) {
    const prevTicks = toNumber(rows[i - 1].rain_ticks_total);
    const currTicks = toNumber(rows[i].rain_ticks_total);

    if (prevTicks == null || currTicks == null) continue;

    const delta = currTicks - prevTicks;
    if (delta > 0) {
      total += delta * MM_PER_TIP;
    }
  }

  return total;
}

export async function POST(req: Request) {
  try {
    let body: {
      deviceId?: string;
      startedAt?: string;
      endedAt?: string | null;
    };

    try {
      body = await req.json();
    } catch {
      return bad("Invalid JSON");
    }

    const deviceId = String(body.deviceId ?? "").trim();
    const startedAt = String(body.startedAt ?? "").trim();
    const endedAt =
      body.endedAt == null || String(body.endedAt).trim() === ""
        ? null
        : String(body.endedAt).trim();

    if (!deviceId) return bad("deviceId is required");
    if (!startedAt) return bad("startedAt is required");

    const startedMs = new Date(startedAt).getTime();
    const endedMs = endedAt ? new Date(endedAt).getTime() : null;

    if (!Number.isFinite(startedMs)) return bad("Invalid startedAt");
    if (endedAt && !Number.isFinite(endedMs)) return bad("Invalid endedAt");
    if (endedMs != null && endedMs <= startedMs) {
      return bad("endedAt must be after startedAt");
    }

    const { data: sensor, error: sensorError } = await supabaseAdmin
      .from("sensors")
      .select("id")
      .eq("id", deviceId)
      .maybeSingle();

    if (sensorError) {
      return bad(`[manual-create] sensor lookup failed: ${sensorError.message}`, 500);
    }

    if (!sensor) {
      return bad("Sensor not found", 404);
    }

    if (endedAt == null) {
      const ongoing = await getOngoingRainEvent(deviceId);
      if (ongoing) {
        return bad("This sensor already has an ongoing event");
      }
    }

    let query = supabaseAdmin
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
      .eq("device_id", deviceId)
      .gte("ts", startedAt)
      .order("ts", { ascending: true });

    if (endedAt != null) {
      query = query.lte("ts", endedAt);
    }

    const { data: rows, error: readingsError } = await query;

    if (readingsError) {
      return bad(`[manual-create] sensor_readings query failed: ${readingsError.message}`, 500);
    }

    const readings = (rows ?? []) as SensorReadingRow[];

    if (readings.length === 0) {
      return bad("No sensor readings found in the selected time range");
    }

    const peakRain = readings.reduce(
      (max, row) => Math.max(max, extractRainMmHr(row)),
      0
    );

    const peakDepth = readings.reduce(
      (max, row) => Math.max(max, extractFloodDepthCm(row)),
      0
    );

    const totalRain = computeTotalRainMm(readings);

    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];

    const created = await createRainEvent({
      device_id: deviceId,
      started_at: startedAt,
      trigger_reason: computeTriggerReason(firstReading),
      total_rain_mm: totalRain,
      peak_rain_rate_mmh: peakRain,
      peak_flood_depth_cm: peakDepth,
      last_signal_at: lastReading.ts,
      last_rain_ticks_total: toNumber(lastReading.rain_ticks_total),
    });

    if (endedAt != null) {
      await updateRainEvent(created.id, {
        status: "resolved",
        ended_at: endedAt,
        ended_reason: "manual_admin_created_resolved",
        updated_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      eventId: created.id,
      readingCount: readings.length,
    });
  } catch (error) {
    console.error("[POST /api/admin/events/manual-create] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to create event",
      },
      { status: 500 }
    );
  }
}