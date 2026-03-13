// app/api/report/export/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRecent, type SensorPoint } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyPoint = Record<string, unknown>;

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
};

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

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function pickDeviceId(p: AnyPoint): string | null {
  const a = typeof p.deviceId === "string" ? p.deviceId : null;
  const b = typeof p.device_id === "string" ? p.device_id : null;
  return a ?? b;
}

function toIso(ts: unknown): string {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts > 1e9 ? ts * 1000 : null;
    if (ms != null) return new Date(ms).toISOString();
  }

  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return "";
}

function sensorPointToPlainRow(point: SensorPoint): AnyPoint {
  return {
    device_id: point.deviceId,
    ts: point.ts,
    raw_dist_cm: point.rawDistCm,
    raw_water_cm: point.rawWaterCm ?? null,
    stable_water_cm: point.stableWaterCm ?? null,
    us_valid: point.usValid,
    accepted_for_stable: point.acceptedForStable,
    overflow: point.overflow,
    rain_ticks_total: point.rainTicksTotal ?? null,
    tips_60: point.tips60 ?? null,
    tips_300: point.tips300 ?? null,
    rain_rate_mmh_60: point.rainRateMmHr60 ?? null,
    rain_rate_mmh_300: point.rainRateMmHr300 ?? null,
    rssi_dbm: point.rssiDbm ?? null,
    dry_distance_cm: point.dryDistanceCm ?? null,
    flood_depth_cm: point.floodDepthCm ?? null,
  };
}

async function getRowsFromSupabase(
  limit: number,
  deviceId?: string | null
): Promise<AnyPoint[] | null> {
  if (!supabase) return null;

  let query = supabase
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
      flood_depth_cm
    `
    )
    .order("ts", { ascending: false })
    .limit(limit);

  if (deviceId) {
    query = query.eq("device_id", deviceId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase export query error:", error);
    return null;
  }

  return (data ?? []).slice().reverse() as AnyPoint[];
}

function getRowsFromMemory(limit: number, deviceId?: string | null): AnyPoint[] {
  const rows = getRecent(limit, deviceId);
  return rows.map(sensorPointToPlainRow);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const deviceId = searchParams.get("deviceId")?.trim() || null;
  const format = (searchParams.get("format") ?? "csv").toLowerCase();
  const limitRaw = Number(searchParams.get("limit") ?? "5000");

  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(Math.floor(limitRaw), 20000))
    : 5000;

  const supabaseRows = await getRowsFromSupabase(limit, deviceId);
  const rows = supabaseRows ?? getRowsFromMemory(limit, deviceId);
  const source = supabaseRows ? "supabase" : "memory";

  if (format === "json") {
    return NextResponse.json({
      ok: true,
      source,
      exportedAt: new Date().toISOString(),
      deviceId,
      count: rows.length,
      rows,
    });
  }

  const headers = [
    "device_id",
    "ts",
    "ts_iso",
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
    "dry_distance_cm",
    "flood_depth_cm",
  ];

  const csvLines = [
    headers.join(","),
    ...rows.map((row) => {
      const values = [
        pickDeviceId(row),
        row.ts ?? row.created_at ?? row.time ?? "",
        toIso(row.ts ?? row.created_at ?? row.time ?? ""),
        row.rawDistCm ?? row.raw_dist_cm ?? "",
        row.rawWaterCm ?? row.raw_water_cm ?? "",
        row.stableWaterCm ?? row.stable_water_cm ?? "",
        row.usValid ?? row.us_valid ?? "",
        row.acceptedForStable ?? row.accepted_for_stable ?? "",
        row.overflow ?? "",
        row.rainTicksTotal ?? row.rain_ticks_total ?? "",
        row.tips60 ?? row.tips_60 ?? "",
        row.tips300 ?? row.tips_300 ?? "",
        row.rainRateMmHr60 ?? row.rain_rate_mmh_60 ?? "",
        row.rainRateMmHr300 ?? row.rain_rate_mmh_300 ?? "",
        row.rssiDbm ?? row.rssi_dbm ?? "",
        row.dryDistanceCm ?? row.dry_distance_cm ?? "",
        row.floodDepthCm ?? row.flood_depth_cm ?? "",
      ];

      return values.map(csvEscape).join(",");
    }),
  ];

  const csv = csvLines.join("\n");

  const filename = deviceId
    ? `sensor-report-${deviceId}.csv`
    : "sensor-report-all.csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Report-Source": source,
    },
  });
}