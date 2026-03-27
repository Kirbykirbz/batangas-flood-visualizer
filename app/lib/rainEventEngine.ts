// app/lib/rainEventEngine.ts

import type { SensorPoint } from "@/app/lib/sensorStore";
import {
  createRainEvent,
  getOngoingRainEvent,
  updateRainEvent,
} from "@/app/lib/eventsRepoServer";
import {
  extractFloodDepthCm,
  extractRainMmHr,
  extractTimestampMs,
  isOverflow,
} from "@/app/lib/sensorReading";

const EVENT_START_RAIN_MMHR = 0.5;
const EVENT_START_DEPTH_CM = 5;
const EVENT_END_COOLDOWN_MIN = 15;
const MM_PER_TIP = 0.327;

function getTips60(point: SensorPoint): number {
  return typeof point.tips60 === "number" && Number.isFinite(point.tips60)
    ? Math.max(0, point.tips60)
    : 0;
}

function getRainTicksTotal(point: SensorPoint): number | null {
  return typeof point.rainTicksTotal === "number" &&
    Number.isFinite(point.rainTicksTotal)
    ? Math.max(0, point.rainTicksTotal)
    : null;
}

function isEventSignalActive(point: SensorPoint): boolean {
  const rainMmHr = extractRainMmHr(point);
  const depthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const tips60 = getTips60(point);

  return (
    rainMmHr >= EVENT_START_RAIN_MMHR ||
    tips60 > 0 ||
    depthCm >= EVENT_START_DEPTH_CM ||
    overflow
  );
}

function minutesBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();

  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 60000);
}

function buildTriggerReason(point: SensorPoint): string {
  const rainMmHr = extractRainMmHr(point);
  const depthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const tips60 = getTips60(point);

  if (overflow) return "overflow detected";

  if (
    depthCm >= EVENT_START_DEPTH_CM &&
    (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0)
  ) {
    return "rainfall and flood depth threshold met";
  }

  if (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0) {
    return "rainfall threshold met";
  }

  if (depthCm >= EVENT_START_DEPTH_CM) {
    return "flood depth threshold met";
  }

  return "sensor event signal detected";
}

function computeRainIncrementMm(args: {
  currentRainTicksTotal: number | null;
  previousRainTicksTotal: number | null;
}): number {
  const { currentRainTicksTotal, previousRainTicksTotal } = args;

  if (currentRainTicksTotal == null) return 0;
  if (previousRainTicksTotal == null) return 0;

  const deltaTicks = currentRainTicksTotal - previousRainTicksTotal;

  if (!Number.isFinite(deltaTicks) || deltaTicks <= 0) {
    return 0;
  }

  return deltaTicks * MM_PER_TIP;
}

export async function processRainEventForReading(point: SensorPoint) {
  const deviceId = point.deviceId;
  const tsMs = extractTimestampMs(point);

  if (!deviceId || tsMs == null) return;

  const timestampIso = new Date(tsMs).toISOString();
  const rainMmHr = extractRainMmHr(point);
  const floodDepthCm = extractFloodDepthCm(point);
  const active = isEventSignalActive(point);
  const currentRainTicksTotal = getRainTicksTotal(point);

  const ongoing = await getOngoingRainEvent(deviceId);

  if (!ongoing) {
    if (!active) return;

    await createRainEvent({
      device_id: deviceId,
      started_at: timestampIso,
      trigger_reason: buildTriggerReason(point),
      total_rain_mm: 0,
      peak_rain_rate_mmh: rainMmHr,
      peak_flood_depth_cm: floodDepthCm,
      last_signal_at: timestampIso,
      last_rain_ticks_total: currentRainTicksTotal,
    });

    return;
  }

  const nextPeakRain = Math.max(ongoing.peak_rain_rate_mmh ?? 0, rainMmHr);
  const nextPeakDepth = Math.max(
    ongoing.peak_flood_depth_cm ?? 0,
    floodDepthCm
  );

  const rainIncrementMm = computeRainIncrementMm({
    currentRainTicksTotal,
    previousRainTicksTotal: ongoing.last_rain_ticks_total,
  });

  const nextTotalRain = Math.max(
    0,
    (ongoing.total_rain_mm ?? 0) + rainIncrementMm
  );

  if (active) {
    await updateRainEvent(ongoing.id, {
      peak_rain_rate_mmh: nextPeakRain,
      peak_flood_depth_cm: nextPeakDepth,
      total_rain_mm: nextTotalRain,
      last_signal_at: timestampIso,
      last_rain_ticks_total: currentRainTicksTotal,
      updated_at: timestampIso,
    });
    return;
  }

  const lastSignalAt =
    ongoing.last_signal_at ?? ongoing.updated_at ?? ongoing.started_at;

  const minutesIdle = minutesBetweenIso(lastSignalAt, timestampIso);

  if (minutesIdle >= EVENT_END_COOLDOWN_MIN) {
    await updateRainEvent(ongoing.id, {
      peak_rain_rate_mmh: nextPeakRain,
      peak_flood_depth_cm: nextPeakDepth,
      total_rain_mm: nextTotalRain,
      last_rain_ticks_total: currentRainTicksTotal,
      status: "resolved",
      ended_at: timestampIso,
      ended_reason: "auto_cooldown_end",
      updated_at: timestampIso,
    });
    return;
  }

  await updateRainEvent(ongoing.id, {
    peak_rain_rate_mmh: nextPeakRain,
    peak_flood_depth_cm: nextPeakDepth,
    total_rain_mm: nextTotalRain,
    last_rain_ticks_total: currentRainTicksTotal,
    updated_at: timestampIso,
  });
}