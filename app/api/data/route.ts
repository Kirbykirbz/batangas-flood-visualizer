// app/api/data/route.ts

import { NextResponse } from "next/server";
import { getLatest, getRecent } from "@/app/lib/sensorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Default remains useful for logs dashboards, but allow light polling:
  // - limit=1 for latest-only
  // - limit=N for recent series
  const limitRaw = searchParams.get("limit");
  const limit = Number(limitRaw ?? "300");

  const safeLimit =
    Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 5000)) : 300;

  return NextResponse.json({
    latest: getLatest(),
    recent: getRecent(safeLimit),
    serverTime: Date.now(),
  });
}