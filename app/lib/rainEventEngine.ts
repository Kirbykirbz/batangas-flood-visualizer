import type { SensorPoint } from "@/app/lib/sensorStore";
import {
  createRainEvent,
  getOngoingRainEvent,
  updateRainEvent,
  type RainEventRecord,
} from "@/app/lib/eventsRepo";
import { extractFloodDepthCm, extractRainMmHr, extractTimestampMs, isOverflow } from "@/app/lib/sensorReading";

const EVENT_START_RAIN_MMHR = 0.5;
const EVENT_START_DEPTH_CM = 5;
const EVENT_END_COOLDOWN_MIN = 15;

function isEventSignalActive(point: SensorPoint): boolean {
  const rainMmHr = extractRainMmHr(point);
  const depthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const tips60 = typeof point.tips60 === "number" ? point.tips60 : 0;

  return (
    rainMmHr >= EVENT_START_RAIN_MMHR ||
    tips60 > 0 ||
    depthCm >= EVENT_START_DEPTH_CM ||
    overflow
  );
}

function estimateRainIncrementMm(point: SensorPoint): number {
  if (typeof point.tips60 === "number") {
    return point.tips60 * 0.327;
  }

  if (typeof point.tips300 === "number") {
    return point.tips300 * 0.327;
  }

  return 0;
}

function minutesBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.max(0, (b - a) / 60000);
}

function buildTriggerReason(point: SensorPoint): string {
  const rainMmHr = extractRainMmHr(point);
  const depthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const tips60 = typeof point.tips60 === "number" ? point.tips60 : 0;

  if (overflow) return "overflow detected";
  if (depthCm >= EVENT_START_DEPTH_CM && rainMmHr >= EVENT_START_RAIN_MMHR) {
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

export async function processRainEventForReading(point: SensorPoint) {
  const deviceId = point.deviceId;
  const tsMs = extractTimestampMs(point);

  if (!deviceId || !tsMs) return;

  const timestampIso = new Date(tsMs).toISOString();
  const rainMmHr = extractRainMmHr(point);
  const floodDepthCm = extractFloodDepthCm(point);
  const active = isEventSignalActive(point);
  const rainIncrementMm = estimateRainIncrementMm(point);

  const ongoing = await getOngoingRainEvent(deviceId);

  if (!ongoing && active) {
    await createRainEvent({
      device_id: deviceId,
      started_at: timestampIso,
      trigger_reason: buildTriggerReason(point),
    });

    return;
  }

  if (!ongoing) {
    return;
  }

  const nextPeakRain = Math.max(ongoing.peak_rain_rate_mmh ?? 0, rainMmHr);
  const nextPeakDepth = Math.max(ongoing.peak_flood_depth_cm ?? 0, floodDepthCm);
  const nextTotalRain = Math.max(0, (ongoing.total_rain_mm ?? 0) + rainIncrementMm);

  if (active) {
    await updateRainEvent(ongoing.id, {
      peak_rain_rate_mmh: nextPeakRain,
      peak_flood_depth_cm: nextPeakDepth,
      total_rain_mm: nextTotalRain,
      updated_at: timestampIso,
    });
    return;
  }

  const minutesIdle = minutesBetween(ongoing.updated_at, timestampIso);

  if (minutesIdle >= EVENT_END_COOLDOWN_MIN) {
    await updateRainEvent(ongoing.id, {
      peak_rain_rate_mmh: nextPeakRain,
      peak_flood_depth_cm: nextPeakDepth,
      total_rain_mm: nextTotalRain,
      status: "resolved",
      ended_at: timestampIso,
      updated_at: timestampIso,
    });
    return;
  }

  await updateRainEvent(ongoing.id, {
    peak_rain_rate_mmh: nextPeakRain,
    peak_flood_depth_cm: nextPeakDepth,
    total_rain_mm: nextTotalRain,
    updated_at: timestampIso,
  });
}