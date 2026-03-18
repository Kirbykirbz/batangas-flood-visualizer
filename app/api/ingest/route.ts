// app/api/ingest/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { appendPoint, SensorPoint } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MM_PER_TIP = Number(process.env.MM_PER_TIP ?? "0.2");

const supabase = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
})();

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  if (typeof v === "number") return v === 1;
  return false;
}

function nullableNonNegative(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nullableNumber(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  if (!supabase) return bad("Server missing Supabase configuration", 500);

  const secret = process.env.INGEST_SECRET;
  if (!secret) return bad("Server missing INGEST_SECRET", 500);

  const auth = req.headers.get("x-ingest-secret");
  if (auth !== secret) return bad("Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  const ts = num(body.ts);
  const deviceId = String(body.deviceId ?? "esp32-1");

  if (!Number.isFinite(ts)) return bad("ts invalid");

  // Raw ultrasonic
  const rawDistCm = num(body.rawDistCm);
  const rawDistOk = Number.isFinite(rawDistCm) && rawDistCm > 0;

  // Flags from device
  const usValidIn = bool(body.usValid);
  const acceptedForStableIn = bool(body.acceptedForStable);
  const overflowIn = bool(body.overflow);

  // Final ultrasonic validity
  const usValid = usValidIn && rawDistOk;
  const acceptedForStable = usValid ? acceptedForStableIn : false;
  const overflow = overflowIn || (rawDistOk && rawDistCm < 20);

  // Server-side dry calibration
  const dryDistanceCm = Number(process.env.DRY_DISTANCE_CM);
  const dryOk = Number.isFinite(dryDistanceCm);

  // Prefer server-computed water depth values
  const rawWaterFromServer =
    dryOk && rawDistOk ? Math.max(0, dryDistanceCm - rawDistCm) : null;

  const floodDepthCm =
    dryOk && usValid ? Math.max(0, dryDistanceCm - rawDistCm) : null;

  // Accept device values if provided, otherwise fall back to server values
  const rawWaterCm = nullableNonNegative(body.rawWaterCm) ?? rawWaterFromServer;
  const stableWaterCm = nullableNonNegative(body.stableWaterCm) ?? rawWaterFromServer;

  // Rain values
  const rainTicksTotal = nullableNonNegative(body.rainTicksTotal);
  const tips60 = nullableNonNegative(body.tips60);
  const tips300 = nullableNonNegative(body.tips300);

  // Prefer server-side rain-rate calculation when tips exist
  const rainRateMmHr60 =
    tips60 != null
      ? tips60 * MM_PER_TIP * 60
      : nullableNonNegative(body.rainRateMmHr60);

  const rainRateMmHr300 =
    tips300 != null
      ? tips300 * MM_PER_TIP * 12
      : nullableNonNegative(body.rainRateMmHr300);

  // Signal (Updated for LTE rssiDbm)
  const rssiDbm = nullableNumber(body.rssiDbm);

  // --- NEW: INA219 Power & Battery Metrics ---
  const vbatV = nullableNumber(body.vbatV);
  const currentMa = nullableNumber(body.currentMa);
  const batteryPercentage = nullableNumber(body.batteryPercentage);

  const point: SensorPoint = {
    ts,
    deviceId,

    rawDistCm: rawDistOk ? rawDistCm : -1,

    rawWaterCm,
    stableWaterCm,

    usValid,
    acceptedForStable,
    overflow,

    rainTicksTotal,
    tips60,
    tips300,
    rainRateMmHr60,
    rainRateMmHr300,

    rssiDbm,

    dryDistanceCm: dryOk ? dryDistanceCm : null,
    floodDepthCm,

    // Include new power fields in local cache
    vbatV,
    currentMa,
    batteryPercentage,
  };

  // Local cache / convenience only
  await appendPoint(point);

  const tsIso = new Date(ts).toISOString();

  const { error } = await supabase.from("sensor_readings").insert({
    device_id: deviceId,
    ts: tsIso,

    raw_dist_cm: rawDistOk ? rawDistCm : null,
    raw_water_cm: rawWaterCm,
    stable_water_cm: stableWaterCm,

    us_valid: usValid,
    accepted_for_stable: acceptedForStable,
    overflow,

    rain_ticks_total: rainTicksTotal,
    tips_60: tips60,
    tips_300: tips300,
    rain_rate_mmh_60: rainRateMmHr60,
    rain_rate_mmh_300: rainRateMmHr300,

    rssi_dbm: rssiDbm,

    flood_depth_cm: floodDepthCm,
    dry_distance_cm: dryOk ? dryDistanceCm : null,

    // --- NEW: Database Mappings for Power ---
    vbat_v: vbatV,
    current_ma: currentMa,
    battery_percentage: batteryPercentage,
  });

  if (error) {
    console.error("Supabase insert error:", error);
    return bad("Database insert failed", 500);
  }

  return NextResponse.json({
    ok: true,
    computed: {
      deviceId,
      usValid,
      rawDistCm: rawDistOk ? rawDistCm : null,
      rawWaterCm,
      stableWaterCm,
      dryDistanceCm: dryOk ? dryDistanceCm : null,
      floodDepthCm,
      rainRateMmHr60,
      rainRateMmHr300,
      batteryPercentage, // Included in response for device verification
    },
  });
}