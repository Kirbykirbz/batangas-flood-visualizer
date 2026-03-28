// app/api/admin/alerts/overview/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import {
  classifyFloodCategory,
  classifyRainCategory,
  deriveAlertLevel,
  mapLevelToSound,
  type DerivedAlertLevel,
  type FloodCategory,
  type RainCategory,
  type SoundKey,
} from "@/app/lib/alertsShared";

type OverviewItem = {
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;

  latestReadingAt: string | null;
  rainRateMmh: number | null;
  floodDepthCm: number | null;
  overflow: boolean;

  floodCategory: FloodCategory;
  rainCategory: RainCategory;
  derivedLevel: DerivedAlertLevel;
  soundKey: SoundKey;

  ongoingRainEventId: number | null;

  latestOpenAlert: {
    id: number;
    level: "watch" | "warning" | "danger" | "overflow" | "info";
    title: string;
    message: string;
    triggeredAt: string;
    acknowledged: boolean;
  } | null;
};

export async function GET() {
  try {
    await requireAdmin();

    const { data: sensors, error: sensorsError } = await supabaseAdmin
      .from("sensors")
      .select("id, name, zone_label, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (sensorsError) {
      throw new Error(`[overview:sensors] ${sensorsError.message}`);
    }

    const items: OverviewItem[] = [];

    for (const sensor of sensors ?? []) {
      const { data: reading, error: readingError } = await supabaseAdmin
        .from("sensor_readings")
        .select("device_id, ts, rain_rate_mmh_300, flood_depth_cm, overflow")
        .eq("device_id", sensor.id)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (readingError) {
        throw new Error(`[overview:reading:${sensor.id}] ${readingError.message}`);
      }

      const { data: openAlert, error: alertError } = await supabaseAdmin
        .from("alerts")
        .select("id, level, title, message, triggered_at, acknowledged")
        .eq("device_id", sensor.id)
        .is("resolved_at", null)
        .order("triggered_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (alertError) {
        throw new Error(`[overview:alert:${sensor.id}] ${alertError.message}`);
      }

      const { data: ongoingEvent, error: eventError } = await supabaseAdmin
        .from("rain_events")
        .select("id")
        .eq("device_id", sensor.id)
        .eq("status", "ongoing")
        .limit(1)
        .maybeSingle();

      if (eventError) {
        throw new Error(`[overview:event:${sensor.id}] ${eventError.message}`);
      }

      const rainRateMmh =
        reading?.rain_rate_mmh_300 != null ? Number(reading.rain_rate_mmh_300) : null;
      const floodDepthCm =
        reading?.flood_depth_cm != null ? Number(reading.flood_depth_cm) : null;
      const overflow = Boolean(reading?.overflow);

      const safeRain = rainRateMmh ?? 0;
      const safeDepth = floodDepthCm ?? 0;

      const derivedLevel = deriveAlertLevel({
        floodDepthCm: safeDepth,
        rainMmHr: safeRain,
        overflow,
      });

      items.push({
        deviceId: sensor.id,
        sensorName: sensor.name,
        zoneLabel: sensor.zone_label ?? null,

        latestReadingAt: reading?.ts ?? null,
        rainRateMmh,
        floodDepthCm,
        overflow,

        floodCategory: classifyFloodCategory({
          floodDepthCm: safeDepth,
          overflow,
        }),
        rainCategory: classifyRainCategory(safeRain),
        derivedLevel,
        soundKey: mapLevelToSound(derivedLevel),

        ongoingRainEventId: ongoingEvent?.id ?? null,

        latestOpenAlert: openAlert
          ? {
              id: Number(openAlert.id),
              level: openAlert.level,
              title: openAlert.title,
              message: openAlert.message,
              triggeredAt: openAlert.triggered_at,
              acknowledged: Boolean(openAlert.acknowledged),
            }
          : null,
      });
    }

    return NextResponse.json({
      ok: true,
      items,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load admin alert overview",
      },
      { status: 500 }
    );
  }
}