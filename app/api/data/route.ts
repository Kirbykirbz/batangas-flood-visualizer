// app/api/data/route.ts

import { NextResponse } from "next/server";
import {
  getLatest,
  getLatestByAllDevices,
  getLatestByDevice,
  getRecent,
  type SensorPoint,
} from "@/app/lib/sensorStore";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRow = {
  device_id: string | null;
  ts: string | null;

  raw_dist_cm: number | null;
  raw_water_cm: number | null;
  stable_water_cm: number | null;

  us_valid: boolean | null;
  accepted_for_stable: boolean | null;
  overflow: boolean | null;

  rain_ticks_total: number | null;
  tips_60: number | null;
  tips_300: number | null;
  rain_rate_mmh_60: number | null;
  rain_rate_mmh_300: number | null;

  rssi_dbm: number | null;

  dry_distance_cm: number | null;
  flood_depth_cm: number | null;

  vbat_v: number | null;
  current_ma: number | null;
  battery_percentage: number | null;
  network_type: string | null;
};

function rowToSensorPoint(row: DbRow): SensorPoint | null {
  if (!row.ts) return null;

  const tsMs = new Date(row.ts).getTime();
  if (!Number.isFinite(tsMs)) return null;

  return {
    ts: tsMs,
    deviceId: row.device_id ?? "esp32-1",

    rawDistCm: row.raw_dist_cm ?? -1,
    rawWaterCm: row.raw_water_cm,
    stableWaterCm: row.stable_water_cm,

    usValid: row.us_valid ?? false,
    acceptedForStable: row.accepted_for_stable ?? false,
    overflow: row.overflow ?? false,

    rainTicksTotal: row.rain_ticks_total,
    tips60: row.tips_60,
    tips300: row.tips_300,

    rainRateMmHr60: row.rain_rate_mmh_60,
    rainRateMmHr300: row.rain_rate_mmh_300,

    rssiDbm: row.rssi_dbm,

    dryDistanceCm: row.dry_distance_cm,
    floodDepthCm: row.flood_depth_cm,

    vbatV: row.vbat_v,
    currentMa: row.current_ma,
    batteryPercentage: row.battery_percentage,
    networkType: row.network_type,
  };
}

async function getRecentFromSupabase(
  limit: number,
  deviceId?: string | null
): Promise<SensorPoint[] | null> {
  let query = supabaseAdmin
    .from("sensor_readings")
    .select(
      `
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
      dry_distance_cm,
      flood_depth_cm,
      vbat_v,
      current_ma,
      battery_percentage,
      network_type
      `
    )
    .order("ts", { ascending: false })
    .limit(limit);

  if (deviceId) {
    query = query.eq("device_id", deviceId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase recent query error:", error);
    return null;
  }

  return (data ?? [])
    .map((row) => rowToSensorPoint(row as DbRow))
    .filter((x): x is SensorPoint => x !== null)
    .sort((a, b) => a.ts - b.ts);
}

async function getLatestByAllDevicesFromSupabase(): Promise<Record<string, SensorPoint> | null> {
  const { data, error } = await supabaseAdmin
    .from("sensor_readings")
    .select(
      `
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
      dry_distance_cm,
      flood_depth_cm,
      vbat_v,
      current_ma,
      battery_percentage,
      network_type
      `
    )
    .order("ts", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("Supabase latestByDevice query error:", error);
    return null;
  }

  const latestMap = new Map<string, SensorPoint>();

  for (const raw of data ?? []) {
    const point = rowToSensorPoint(raw as DbRow);
    if (!point) continue;

    const existing = latestMap.get(point.deviceId);
    if (!existing || point.ts >= existing.ts) {
      latestMap.set(point.deviceId, point);
    }
  }

  return Object.fromEntries(latestMap.entries());
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const limitRaw = searchParams.get("limit");
  const deviceId = searchParams.get("deviceId")?.trim() || null;

  const limit = Number(limitRaw ?? "300");
  const safeLimit =
    Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 5000)) : 300;

  const supabaseRecent = await getRecentFromSupabase(safeLimit, deviceId);
  const supabaseLatestByDevice = await getLatestByAllDevicesFromSupabase();

  if (supabaseRecent && supabaseLatestByDevice) {
    const latest =
      deviceId != null
        ? supabaseLatestByDevice[deviceId] ??
          (supabaseRecent.length ? supabaseRecent[supabaseRecent.length - 1] : null)
        : supabaseRecent.length
        ? supabaseRecent[supabaseRecent.length - 1]
        : null;

    return NextResponse.json({
      latest,
      recent: supabaseRecent,
      latestByDevice: supabaseLatestByDevice,
      source: "supabase",
      serverTime: Date.now(),
    });
  }

  // Fallback to in-memory store
  const recent = getRecent(safeLimit, deviceId);
  const latest = deviceId ? getLatestByDevice(deviceId) : getLatest();
  const latestByDevice = getLatestByAllDevices();

  return NextResponse.json({
    latest,
    recent,
    latestByDevice,
    source: "memory",
    serverTime: Date.now(),
  });
}