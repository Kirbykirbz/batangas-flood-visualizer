import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type PublicRainEvent = {
  id: number;
  device_id: string;
  sensor_name: string | null;
  zone_label: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  trigger_reason: string | null;
  ended_reason: string | null;
  total_rain_mm: number;
  peak_rain_rate_mmh: number;
  peak_flood_depth_cm: number;
  total_tips: number;
  last_tip_at: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 200))
      : 100;

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("rain_events")
      .select(
        `
          id,
          device_id,
          started_at,
          ended_at,
          status,
          trigger_reason,
          ended_reason,
          total_rain_mm,
          peak_rain_rate_mmh,
          peak_flood_depth_cm,
          total_tips,
          last_tip_at
        `
      )
      .order("started_at", { ascending: false })
      .limit(limit);

    if (eventsError) {
      throw new Error(`[GET /api/events] ${eventsError.message}`);
    }

    const deviceIds = Array.from(
      new Set((events ?? []).map((e) => e.device_id).filter(Boolean))
    );

    let sensorMap = new Map<
      string,
      { name: string | null; zone_label: string | null }
    >();

    if (deviceIds.length > 0) {
      const { data: sensors, error: sensorsError } = await supabaseAdmin
        .from("sensors")
        .select("id, name, zone_label")
        .in("id", deviceIds);

      if (sensorsError) {
        throw new Error(`[GET /api/events:sensors] ${sensorsError.message}`);
      }

      sensorMap = new Map(
        (sensors ?? []).map((sensor) => [
          sensor.id,
          {
            name: sensor.name ?? null,
            zone_label: sensor.zone_label ?? null,
          },
        ])
      );
    }

    const rows: PublicRainEvent[] = (events ?? []).map((event) => {
      const sensor = sensorMap.get(event.device_id);

      return {
        id: Number(event.id),
        device_id: event.device_id,
        sensor_name: sensor?.name ?? null,
        zone_label: sensor?.zone_label ?? null,
        started_at: event.started_at,
        ended_at: event.ended_at,
        status: event.status,
        trigger_reason: event.trigger_reason ?? null,
        ended_reason: event.ended_reason ?? null,
        total_rain_mm: Number(event.total_rain_mm ?? 0),
        peak_rain_rate_mmh: Number(event.peak_rain_rate_mmh ?? 0),
        peak_flood_depth_cm: Number(event.peak_flood_depth_cm ?? 0),
        total_tips: Number(event.total_tips ?? 0),
        last_tip_at: event.last_tip_at ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      events: rows,
    });
  } catch (error) {
    console.error("[GET /api/events] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to load rain events",
      },
      { status: 500 }
    );
  }
}