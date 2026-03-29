import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = (await req.json()) as {
      deviceId?: string;
      notes?: string;
    };

    const deviceId = String(body.deviceId ?? "").trim();
    const notes = String(body.notes ?? "").trim() || null;

    if (!deviceId) {
      return NextResponse.json(
        { ok: false, error: "deviceId is required" },
        { status: 400 }
      );
    }

    const { data: sensor, error: sensorError } = await supabaseAdmin
      .from("sensors")
      .select("id, is_active, name")
      .eq("id", deviceId)
      .single();

    if (sensorError || !sensor) {
      return NextResponse.json(
        { ok: false, error: "Sensor not found" },
        { status: 404 }
      );
    }

    if (!sensor.is_active) {
      return NextResponse.json(
        { ok: false, error: "Sensor is inactive" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("device_commands")
      .select("id, status, requested_at")
      .eq("device_id", deviceId)
      .eq("command_type", "restart")
      .in("status", ["pending", "acknowledged"])
      .gte("expires_at", nowIso)
      .order("requested_at", { ascending: false })
      .limit(1);

    if (existingError) throw existingError;

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "A restart command is already pending for this device.",
          existing: existing[0],
        },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("device_commands")
      .insert({
        device_id: deviceId,
        command_type: "restart",
        status: "pending",
        requested_by: "admin",
        requested_at: nowIso,
        expires_at: expiresAtIso,
        notes,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      ok: true,
      message: `Restart command queued for ${deviceId}`,
      command: inserted,
    });
  } catch (error) {
    console.error("[POST /api/admin/devices/restart] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to queue restart command" },
      { status: 500 }
    );
  }
}