// app/api/data/route.ts

import { NextResponse } from "next/server";
import { getLatest, getRecent } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SensorPointLike = {
  deviceId?: string | null;
  device_id?: string | null;
  ts?: number | string | null;
};

function getDeviceId(p: SensorPointLike): string {
  if (typeof p.deviceId === "string" && p.deviceId.trim() !== "") return p.deviceId;
  if (typeof p.device_id === "string" && p.device_id.trim() !== "") return p.device_id;
  return "esp32-1";
}

function getTs(p: SensorPointLike): number {
  if (typeof p.ts === "number" && Number.isFinite(p.ts)) return p.ts;
  if (typeof p.ts === "string" && p.ts.trim() !== "") {
    const n = Number(p.ts);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const limitRaw = searchParams.get("limit");
  const deviceId = searchParams.get("deviceId")?.trim() || null;

  const limit = Number(limitRaw ?? "300");
  const safeLimit =
    Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 5000)) : 300;

  const allRecent = getRecent(5000) as SensorPointLike[];
  const filteredRecent = deviceId
    ? allRecent.filter((p) => getDeviceId(p) === deviceId)
    : allRecent;

  const recent = filteredRecent.slice(-safeLimit);
  const latest = recent.length > 0 ? recent[recent.length - 1] : null;

  // Build latest reading per device for map/dashboard multi-device support
  const latestByDeviceMap = new Map<string, SensorPointLike>();

  for (const point of filteredRecent) {
    const id = getDeviceId(point);
    const prev = latestByDeviceMap.get(id);

    if (!prev || getTs(point) >= getTs(prev)) {
      latestByDeviceMap.set(id, point);
    }
  }

  const latestByDevice = Object.fromEntries(latestByDeviceMap.entries());

  return NextResponse.json({
    latest,
    recent,
    latestByDevice,
    serverTime: Date.now(),
  });
}
