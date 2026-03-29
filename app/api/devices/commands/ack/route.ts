import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireDeviceAuth } from "@/app/lib/deviceAuthServer";

type AckBody = {
  deviceId?: string;
  commandId?: number;
  status?: "acknowledged" | "executed" | "failed";
  notes?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AckBody;

    const deviceId = String(body.deviceId ?? "").trim();
    const commandId = Number(body.commandId ?? 0);
    const status = String(body.status ?? "").trim();
    const notes = String(body.notes ?? "").trim() || null;

    if (!deviceId || !commandId || !status) {
      return NextResponse.json(
        { ok: false, error: "deviceId, commandId, and status are required" },
        { status: 400 }
      );
    }

    if (!["acknowledged", "executed", "failed"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 }
      );
    }

    requireDeviceAuth(req, deviceId);

    const nowIso = new Date().toISOString();

    const patch: Record<string, unknown> = {
      status,
      notes,
    };

    if (status === "acknowledged") patch.acknowledged_at = nowIso;
    if (status === "executed") patch.executed_at = nowIso;
    if (status === "failed") patch.failed_at = nowIso;

    const { data, error } = await supabaseAdmin
      .from("device_commands")
      .update(patch)
      .eq("id", commandId)
      .eq("device_id", deviceId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      command: data,
    });
  } catch (error) {
    console.error("[POST /api/device/commands/ack] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update command status" },
      { status: 401 }
    );
  }
}