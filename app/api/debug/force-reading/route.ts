import { NextResponse } from "next/server";
import { appendPoint } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMP DEBUG ENDPOINT (delete after testing)
 * Usage:
 *  /api/debug/force-reading?stable=0&rain=0
 *  /api/debug/force-reading?stable=30&rain=50
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const stable = Number(searchParams.get("stable") ?? "0");
  const rain = Number(searchParams.get("rain") ?? "0");

  const ts = Date.now() + 5000; // ensure it's newer than any device clock drift

  await appendPoint({
    ts,
    deviceId: "debug",
    rawDistCm: 999,
    rawWaterCm: stable,
    stableWaterCm: stable,
    usValid: true,
    acceptedForStable: true,
    overflow: false,
    rainTicksTotal: 0,
    tips60: 0,
    tips300: 0,
    rainRateMmHr60: rain,
    rainRateMmHr300: rain,
    rssiDbm: -50,
  });

  return NextResponse.json({
    ok: true,
    forced: { ts, stableWaterCm: stable, rainRateMmHr60: rain },
  });
}