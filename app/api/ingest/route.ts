// app/api/ingest/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { appendPoint, SensorPoint } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
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

export async function POST(req: Request) {
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

  // Ultrasonic
  const rawDistCm = num(body.rawDistCm);
  const rawWaterCm = num(body.rawWaterCm);
  const stableWaterCm = num(body.stableWaterCm);

  // Flags
  const usValidIn = bool(body.usValid);
  const acceptedForStable = bool(body.acceptedForStable);
  const overflow = bool(body.overflow);

  // Rain
  const rainTicksTotal = num(body.rainTicksTotal);
  const tips60 = num(body.tips60);
  const tips300 = num(body.tips300);
  const rainRateMmHr60 = num(body.rainRateMmHr60);
  const rainRateMmHr300 = num(body.rainRateMmHr300);

  // WiFi
  const rssiDbm = num(body.rssiDbm);

  if (!Number.isFinite(ts)) return bad("ts invalid");

  // IMPORTANT:
  // rawDist can be -1 when invalid (ESP sends -1). That's finite but not usable.
  const rawDistOk = Number.isFinite(rawDistCm) && rawDistCm > 0;

  // If ESP says invalid, trust it. Also force invalid if rawDist is not usable.
  const usValid = usValidIn && rawDistOk;

  // Dry-distance calibration
  const dryDistanceCm = Number(process.env.DRY_DISTANCE_CM);
  const dryOk = Number.isFinite(dryDistanceCm);

  // Compute flood depth ONLY when ultrasonic is valid and dry calibration exists
  const floodDepthCm =
    dryOk && usValid ? Math.max(0, dryDistanceCm - rawDistCm) : null;

  // Build SensorPoint
  const p: SensorPoint = {
    ts,
    deviceId,

    // Keep rawDist as the device sent for debugging, even if invalid
    rawDistCm: rawDistOk ? rawDistCm : -1,

    rawWaterCm: Number.isFinite(rawWaterCm) && rawWaterCm >= 0 ? rawWaterCm : null,
    stableWaterCm: Number.isFinite(stableWaterCm) && stableWaterCm >= 0 ? stableWaterCm : null,

    usValid,
    acceptedForStable: usValid ? acceptedForStable : false,
    overflow,

    rainTicksTotal: Number.isFinite(rainTicksTotal) ? rainTicksTotal : null,
    tips60: Number.isFinite(tips60) ? tips60 : null,
    tips300: Number.isFinite(tips300) ? tips300 : null,
    rainRateMmHr60: Number.isFinite(rainRateMmHr60) ? rainRateMmHr60 : null,
    rainRateMmHr300: Number.isFinite(rainRateMmHr300) ? rainRateMmHr300 : null,

    rssiDbm: Number.isFinite(rssiDbm) ? rssiDbm : null,

    dryDistanceCm: dryOk ? dryDistanceCm : null,
    floodDepthCm, // already null-safe
  };

  await appendPoint(p);

  // Optional: persist to Supabase
  if (supabase) {
    const tsIso = new Date(ts).toISOString();

    const { error } = await supabase.from("sensor_readings").insert({
      device_id: deviceId,
      ts: tsIso,

      raw_dist_cm: rawDistOk ? rawDistCm : null,
      raw_water_cm: Number.isFinite(rawWaterCm) && rawWaterCm >= 0 ? rawWaterCm : null,
      stable_water_cm: Number.isFinite(stableWaterCm) && stableWaterCm >= 0 ? stableWaterCm : null,

      us_valid: usValid,
      accepted_for_stable: usValid ? acceptedForStable : false,
      overflow,

      rain_ticks_total: Number.isFinite(rainTicksTotal) ? rainTicksTotal : null,
      tips_60: Number.isFinite(tips60) ? tips60 : null,
      tips_300: Number.isFinite(tips300) ? tips300 : null,
      rain_rate_mmh_60: Number.isFinite(rainRateMmHr60) ? rainRateMmHr60 : null,
      rain_rate_mmh_300: Number.isFinite(rainRateMmHr300) ? rainRateMmHr300 : null,

      rssi_dbm: Number.isFinite(rssiDbm) ? rssiDbm : null,

      flood_depth_cm: floodDepthCm,
      dry_distance_cm: dryOk ? dryDistanceCm : null,
    });

    if (error) console.error("Supabase insert error:", error);
  }

  return NextResponse.json({
    ok: true,
    computed: {
      deviceId,
      usValid,
      rawDistCm: rawDistOk ? rawDistCm : null,
      dryDistanceCm: dryOk ? dryDistanceCm : null,
      floodDepthCm,
    },
  });
}