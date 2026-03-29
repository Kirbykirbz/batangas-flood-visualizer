import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireDeviceAuth } from "@/app/lib/deviceAuthServer";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = String(searchParams.get("deviceId") ?? "").trim();

    if (!deviceId) {
      return NextResponse.json(
        { ok: false, error: "deviceId is required" },
        { status: 400 }
      );
    }

    requireDeviceAuth(req, deviceId);

    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("device_commands")
      .select("id, device_id, command_type, payload, requested_at, expires_at, notes")
      .eq("device_id", deviceId)
      .eq("status", "pending")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("requested_at", { ascending: true })
      .limit(1);

    if (error) throw error;

    const command = data?.[0] ?? null;

    return NextResponse.json({
      ok: true,
      command: command
        ? {
            id: command.id,
            deviceId: command.device_id,
            commandType: command.command_type,
            payload: command.payload,
            requestedAt: command.requested_at,
            expiresAt: command.expires_at,
            notes: command.notes,
          }
        : null,
    });
  } catch (error) {
    console.error("[GET /api/device/commands] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch commands" },
      { status: 401 }
    );
  }
}