// app/api/ingest/route.ts

import { NextResponse } from "next/server";
import { appendPoint, type SensorPoint } from "@/app/lib/sensorStore";
import { processRainEventForReading } from "@/app/lib/rainEventEngine";
import { processAlertsForReading } from "@/app/lib/alertsEngine";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  deriveCanonicalSensorFields,
  nullableEpochMs,
} from "@/app/lib/canonicalSensorReading";
import { toNumber } from "@/app/lib/sensorReading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SensorMetaRow = {
  id: string;
  dry_distance_cm: number | null;
  is_active: boolean;
};

type InsertReadingRow = {
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
  vbat_v: number | null;
  current_ma: number | null;
  battery_percentage: number | null;
  network_type: string | null;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function resolveMmPerTip(): number {
  const n = toNumber(process.env.MM_PER_TIP);
  return n != null && n > 0 ? n : 0.27;
}

async function getSensorMeta(deviceId: string): Promise<SensorMetaRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sensors")
    .select("id, dry_distance_cm, is_active")
    .eq("id", deviceId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data as SensorMetaRow;
}

function buildCanonicalPoint(args: {
  ts: number;
  deviceId: string;
  derived: ReturnType<typeof deriveCanonicalSensorFields>;
}): SensorPoint {
  const { ts, deviceId, derived } = args;

  return {
    ts,
    deviceId,

    rawDistCm: derived.rawDistCm,
    rawWaterCm: derived.rawWaterCm,
    stableWaterCm: derived.stableWaterCm,

    usValid: derived.usValid,
    acceptedForStable: derived.acceptedForStable,
    overflow: derived.overflow,

    rainTicksTotal: derived.rainTicksTotal,
    tips60: derived.tips60,
    tips300: derived.tips300,

    rainRateMmHr60: derived.rainRateMmHr60,
    rainRateMmHr300: derived.rainRateMmHr300,

    rssiDbm: derived.rssiDbm,

    dryDistanceCm: derived.dryDistanceCm,
    floodDepthCm: derived.floodDepthCm,

    vbatV: derived.vbatV,
    currentMa: derived.currentMa,
    batteryPercentage: derived.batteryPercentage,
    networkType: derived.networkType,
  };
}

function buildInsertRow(args: {
  deviceId: string;
  tsIso: string;
  derived: ReturnType<typeof deriveCanonicalSensorFields>;
}): InsertReadingRow {
  const { deviceId, tsIso, derived } = args;

  return {
    device_id: deviceId,
    ts: tsIso,

    raw_dist_cm: derived.rawDistCm,
    raw_water_cm: derived.rawWaterCm,
    stable_water_cm: derived.stableWaterCm,

    us_valid: derived.usValid,
    accepted_for_stable: derived.acceptedForStable,
    overflow: derived.overflow,

    rain_ticks_total: derived.rainTicksTotal,
    tips_60: derived.tips60,
    tips_300: derived.tips300,
    rain_rate_mmh_60: derived.rainRateMmHr60,
    rain_rate_mmh_300: derived.rainRateMmHr300,

    rssi_dbm: derived.rssiDbm,

    flood_depth_cm: derived.floodDepthCm,
    dry_distance_cm: derived.dryDistanceCm,

    vbat_v: derived.vbatV,
    current_ma: derived.currentMa,
    battery_percentage: derived.batteryPercentage,
    network_type: derived.networkType,
  };
}

export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return bad("Server missing INGEST_SECRET", 500);
  }

  const auth = req.headers.get("x-ingest-secret");
  if (auth !== secret) {
    return bad("Unauthorized", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  const deviceId = String(body.deviceId ?? "").trim();
  const ts = nullableEpochMs(body.ts);

  if (!deviceId) {
    return bad("deviceId missing");
  }

  if (ts == null) {
    return bad("ts invalid");
  }

  let sensor: SensorMetaRow | null;
  try {
    sensor = await getSensorMeta(deviceId);
  } catch (error) {
    console.error("[ingest] getSensorMeta failed:", error);
    return bad("Failed to load sensor metadata", 500);
  }

  if (!sensor) {
    return bad(`Unknown sensor: ${deviceId}`, 404);
  }

  if (!sensor.is_active) {
    return bad(`Sensor is inactive: ${deviceId}`, 403);
  }

  const fallbackEnvDryDistanceCm = toNumber(process.env.DRY_DISTANCE_CM);
  const mmPerTip = resolveMmPerTip();

  const derived = deriveCanonicalSensorFields(body, {
    sensorDryDistanceCm: sensor.dry_distance_cm,
    fallbackEnvDryDistanceCm,
    mmPerTip,
  });

  const usedEnvDryDistanceFallback =
    sensor.dry_distance_cm == null && fallbackEnvDryDistanceCm != null;

  if (usedEnvDryDistanceFallback) {
    console.warn(
      `[ingest] sensor ${deviceId} missing sensors.dry_distance_cm, using env fallback`
    );
  }

  const canonicalPoint = buildCanonicalPoint({
    ts,
    deviceId,
    derived,
  });

  const insertRow = buildInsertRow({
    deviceId,
    tsIso: new Date(ts).toISOString(),
    derived,
  });

  const { error: insertError } = await supabaseAdmin
    .from("sensor_readings")
    .insert(insertRow);

  if (insertError) {
    console.error("[ingest] sensor_readings insert failed:", insertError);
    return bad("Database insert failed", 500);
  }

  try {
    await appendPoint(canonicalPoint);
  } catch (error) {
    console.error("[ingest] appendPoint failed:", error);
  }

  try {
    await processRainEventForReading(canonicalPoint);
  } catch (error) {
    console.error("[ingest] processRainEventForReading failed:", error);
  }

  try {
    await processAlertsForReading(canonicalPoint);
  } catch (error) {
    console.error("[ingest] processAlertsForReading failed:", error);
  }

  return NextResponse.json({
    ok: true,
    computed: {
      deviceId,
      ts,
      rawDistCm: derived.rawDistCm,
      rawWaterCm: derived.rawWaterCm,
      stableWaterCm: derived.stableWaterCm,
      usValid: derived.usValid,
      acceptedForStable: derived.acceptedForStable,
      overflow: derived.overflow,
      dryDistanceCm: derived.dryDistanceCm,
      floodDepthCm: derived.floodDepthCm,
      rainTicksTotal: derived.rainTicksTotal,
      tips60: derived.tips60,
      tips300: derived.tips300,
      rainRateMmHr60: derived.rainRateMmHr60,
      rainRateMmHr300: derived.rainRateMmHr300,
      rssiDbm: derived.rssiDbm,
      vbatV: derived.vbatV,
      currentMa: derived.currentMa,
      batteryPercentage: derived.batteryPercentage,
      networkType: derived.networkType,
      usedEnvDryDistanceFallback,
    },
  });
}