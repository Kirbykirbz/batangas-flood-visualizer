// app/api/admin/alerts/send/route.ts
// app/api/admin/alerts/send/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  defaultAlertMessage,
  defaultAlertTitle,
  type AlertLevel,
} from "@/app/lib/alertsShared";
import { createAlertServer } from "@/app/lib/alertsRepoServer";
import { sendPushAlert } from "@/app/lib/pushNotifier";

type RequestBody = {
  targetMode?: "all" | "device";
  deviceId?: string | null;
  level?: AlertLevel;
  title?: string;
  message?: string;
  url?: string;
  createHistory?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = (await req.json()) as RequestBody;

    const targetMode = body.targetMode === "device" ? "device" : "all";
    const deviceId =
      targetMode === "device" ? String(body.deviceId ?? "").trim() : null;

    const level: AlertLevel =
      body.level === "watch" ||
      body.level === "warning" ||
      body.level === "danger" ||
      body.level === "overflow" ||
      body.level === "info"
        ? body.level
        : "info";

    if (targetMode === "device" && !deviceId) {
      return NextResponse.json(
        { ok: false, error: "deviceId is required when targetMode is 'device'" },
        { status: 400 }
      );
    }

    let sensorName: string | null = null;
    let zoneLabel: string | null = null;
    let floodDepthCm: number | null = null;
    let rainMmHr: number | null = null;
    let rainEventId: number | null = null;

    if (deviceId) {
      const { data: sensor, error: sensorError } = await supabaseAdmin
        .from("sensors")
        .select("id, name, zone_label")
        .eq("id", deviceId)
        .maybeSingle();

      if (sensorError) {
        throw new Error(`[alerts/send:sensor] ${sensorError.message}`);
      }

      if (!sensor) {
        return NextResponse.json(
          { ok: false, error: `Sensor not found for deviceId '${deviceId}'` },
          { status: 404 }
        );
      }

      sensorName = typeof sensor.name === "string" ? sensor.name : null;
      zoneLabel =
        typeof sensor.zone_label === "string" ? sensor.zone_label : null;

      const { data: latestReading, error: readingError } = await supabaseAdmin
        .from("sensor_readings")
        .select("flood_depth_cm, rain_rate_mmh_300")
        .eq("device_id", deviceId)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (readingError) {
        throw new Error(`[alerts/send:reading] ${readingError.message}`);
      }

      floodDepthCm =
        latestReading?.flood_depth_cm != null
          ? Number(latestReading.flood_depth_cm)
          : null;

      rainMmHr =
        latestReading?.rain_rate_mmh_300 != null
          ? Number(latestReading.rain_rate_mmh_300)
          : null;

      const { data: ongoingEvent, error: eventError } = await supabaseAdmin
        .from("rain_events")
        .select("id")
        .eq("device_id", deviceId)
        .eq("status", "ongoing")
        .limit(1)
        .maybeSingle();

      if (eventError) {
        throw new Error(`[alerts/send:event] ${eventError.message}`);
      }

      rainEventId = ongoingEvent?.id != null ? Number(ongoingEvent.id) : null;
    }

    const title =
      String(body.title ?? "").trim() ||
      defaultAlertTitle({ level, sensorName });

    const message =
      String(body.message ?? "").trim() ||
      defaultAlertMessage({
        level,
        sensorName,
        floodDepthCm,
        rainMmHr,
        zoneLabel,
      });

    const url =
      String(body.url ?? "").trim() ||
      (deviceId
        ? `/dashboard?sensor=${encodeURIComponent(deviceId)}`
        : "/dashboard");

    let createdAlertId: number | null = null;
    const shouldCreateHistory = Boolean(body.createHistory && deviceId);

    if (shouldCreateHistory && deviceId) {
      const created = await createAlertServer({
        device_id: deviceId,
        rain_event_id: rainEventId,
        level,
        title,
        message,
      });

      createdAlertId = Number(created.id);
    }

    const triggeredAt = new Date().toISOString();

    const pushResult = await sendPushAlert({
      title,
      message,
      url,
      deviceId: targetMode === "device" ? deviceId : null,
      sensorName,
      zoneLabel,
      alertId: createdAlertId,
      level,
      triggeredAt,
    });

    return NextResponse.json({
      ok: true,
      sent: Number(pushResult?.sent ?? 0),
      failed: Number(pushResult?.failed ?? 0),
      createdAlertId,
      title,
      message,
      url,
      level,
      sensorName,
      zoneLabel,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send admin alert",
      },
      { status: 500 }
    );
  }
}