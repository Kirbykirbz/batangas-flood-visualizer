import { NextResponse } from "next/server";
import { setRestart } from "@/app/lib/deviceCommands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const deviceId = body.deviceId;

  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  setRestart(deviceId);

  return NextResponse.json({ ok: true, message: "Restart command queued" });
}