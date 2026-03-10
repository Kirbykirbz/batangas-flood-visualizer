import { NextResponse } from "next/server";
import { appendPoint } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Usage examples:
 * 
 * /api/simulate?dist=183&rain=0
 * /api/simulate?dist=168&rain=20
 * /api/simulate?dist=153&rain=50
 *
 * dist = rawDistCm (ultrasonic distance to surface)
 * rain = rain mm/hr (60s)
 */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const rawDistCm = Number(searchParams.get("dist") ?? "182.88");
  const rain = Number(searchParams.get("rain") ?? "0");

  const ts = Date.now() + 5000; // guarantee newest reading

  const dryDistanceCm = Number(process.env.DRY_DISTANCE_CM);

  const floodDepthCm =
    Number.isFinite(dryDistanceCm)
      ? Math.max(0, dryDistanceCm - rawDistCm)
      : null;

  const point = {
    ts,
    deviceId: "simulator",

    rawDistCm,
    rawWaterCm: 0,
    stableWaterCm: 0,

    usValid: true,
    acceptedForStable: true,
    overflow: false,

    rainTicksTotal: 0,
    tips60: 0,
    tips300: 0,
    rainRateMmHr60: rain,
    rainRateMmHr300: rain,

    rssiDbm: -50,

    dryDistanceCm,
    floodDepthCm,
  } as const;

  await appendPoint(point);

  return NextResponse.json({
    ok: true,
    simulated: {
      rawDistCm,
      rain,
      floodDepthCm,
    },
  });
}