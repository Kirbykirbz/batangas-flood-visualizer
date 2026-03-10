import { NextResponse } from "next/server";
import { consumeCommand } from "@/app/lib/deviceCommands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get("deviceId");

  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const cmd = consumeCommand(deviceId);

  return NextResponse.json(cmd);
}