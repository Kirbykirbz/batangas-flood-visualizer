import { NextResponse } from "next/server";
import { getRainEventById, updateRainEvent } from "@/app/lib/eventsRepoServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { toNumber } from "@/app/lib/sensorReading";

const MM_PER_TIP = 0.27;

type SensorReadingRow = {
  id: number;
  device_id: string;
  ts: string;
  rain_ticks_total: number | null;
  tips_60: number | null;
  rain_rate_mmh_60: number | null;
  rain_rate_mmh_300: number | null;
  flood_depth_cm: number | null;
  overflow: boolean;
};

function extractRainMmHr(row: SensorReadingRow): number {
  return toNumber(row.rain_rate_mmh_300) ?? toNumber(row.rain_rate_mmh_60) ?? 0;
}

function extractFloodDepthCm(row: SensorReadingRow): number {
  return toNumber(row.flood_depth_cm) ?? 0;
}

function computeTotalRainMm(rows: SensorReadingRow[]): number {
  if (rows.length < 2) return 0;

  let total = 0;

  for (let i = 1; i < rows.length; i++) {
    const prevTicks = toNumber(rows[i - 1].rain_ticks_total);
    const currTicks = toNumber(rows[i].rain_ticks_total);

    if (prevTicks == null || currTicks == null) continue;

    const delta = currTicks - prevTicks;
    if (delta > 0) total += delta * MM_PER_TIP;
  }

  return total;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const eventId = Number(id);

  if (!Number.isFinite(eventId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid event id" },
      { status: 400 }
    );
  }

  try {
    const event = await getRainEventById(eventId);

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Event not found" },
        { status: 404 }
      );
    }

    const endIso = event.ended_at ?? new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sensor_readings")
      .select("id, device_id, ts, rain_ticks_total, tips_60, rain_rate_mmh_60, rain_rate_mmh_300, flood_depth_cm, overflow")
      .eq("device_id", event.device_id)
      .gte("ts", event.started_at)
      .lte("ts", endIso)
      .order("ts", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: `[regenerate] ${error.message}` },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as SensorReadingRow[];

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No sensor readings found for this event window" },
        { status: 400 }
      );
    }

    const peakRain = rows.reduce((max, row) => Math.max(max, extractRainMmHr(row)), 0);
    const peakDepth = rows.reduce((max, row) => Math.max(max, extractFloodDepthCm(row)), 0);
    const totalRain = computeTotalRainMm(rows);
    const lastReading = rows[rows.length - 1];

    await updateRainEvent(eventId, {
      peak_rain_rate_mmh: peakRain,
      peak_flood_depth_cm: peakDepth,
      total_rain_mm: totalRain,
      last_signal_at: lastReading.ts,
      last_rain_ticks_total: toNumber(lastReading.rain_ticks_total),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, eventId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to regenerate event",
      },
      { status: 500 }
    );
  }
}