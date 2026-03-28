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

// Lower end threshold to avoid flapping.
const EVENT_END_DEPTH_CM = 2;

// Resolve faster after last actual rain tip.
const EVENT_END_RAIN_INACTIVE_MIN = 10;

// Canonical calibration value.
const MM_PER_TIP = 0.27;

function getTips60(point: SensorPoint): number {
  return typeof point.tips60 === "number" && Number.isFinite(point.tips60)
    ? Math.max(0, point.tips60)
    : 0;
}

function getTips300(point: SensorPoint): number {
  return typeof point.tips300 === "number" && Number.isFinite(point.tips300)
    ? Math.max(0, point.tips300)
    : 0;
}

function getRainTicksTotal(point: SensorPoint): number | null {
  return typeof point.rainTicksTotal === "number" &&
    Number.isFinite(point.rainTicksTotal)
    ? Math.max(0, point.rainTicksTotal)
    : null;
}

function isStartSignalActive(point: SensorPoint): boolean {
  const rainMmHr = extractRainMmHr(point);
  const depthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const tips60 = getTips60(point);
  const tips300 = getTips300(point);

  return (
    rainMmHr >= EVENT_START_RAIN_MMHR ||
    tips60 > 0 ||
    tips300 > 0 ||
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
  const tips300 = getTips300(point);

  if (overflow) return "overflow_detected";

  if (
    depthCm >= EVENT_START_DEPTH_CM &&
    (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0 || tips300 > 0)
  ) {
    return "rain_and_flood_threshold_met";
  }

  if (rainMmHr >= EVENT_START_RAIN_MMHR || tips60 > 0 || tips300 > 0) {
    return "rainfall_threshold_met";
  }

  if (depthCm >= EVENT_START_DEPTH_CM) {
    return "flood_depth_threshold_met";
  }

  return "sensor_event_signal_detected";
}

function computeDeltaTicks(args: {
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

  return deltaTicks;
}

function hasTipSignal(point: SensorPoint): boolean {
  return getTips60(point) > 0 || getTips300(point) > 0;
}

function hasRecentTip(lastTipAtIso: string | null, nowIso: string): boolean {
  if (!lastTipAtIso) return false;
  return minutesBetweenIso(lastTipAtIso, nowIso) < EVENT_END_RAIN_INACTIVE_MIN;
}

export async function processRainEventForReading(point: SensorPoint) {
  const deviceId = point.deviceId;
  const tsMs = extractTimestampMs(point);

  if (!deviceId || tsMs == null) return;

  const timestampIso = new Date(tsMs).toISOString();
  const rainMmHr = extractRainMmHr(point);
  const floodDepthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);
  const currentRainTicksTotal = getRainTicksTotal(point);

  const tipSignalNow = hasTipSignal(point);
  const startSignalActive = isStartSignalActive(point);

  const ongoing = await getOngoingRainEvent(deviceId);

  if (!ongoing) {
    if (!startSignalActive) return;

    // Count the first visible tip signal when the event starts.
    // If the event is triggered by a single first tip reading, we should not lose it.
    const initialTipCount = tipSignalNow ? 1 : 0;
    const initialRainMm = initialTipCount * MM_PER_TIP;
    const initialLastTipAt = tipSignalNow ? timestampIso : null;

    await createRainEvent({
      device_id: deviceId,
      started_at: timestampIso,
      trigger_reason: buildTriggerReason(point),
      total_rain_mm: initialRainMm,
      peak_rain_rate_mmh: rainMmHr,
      peak_flood_depth_cm: floodDepthCm,
      last_signal_at: timestampIso,
      last_tip_at: initialLastTipAt,
      last_rain_ticks_total: currentRainTicksTotal,
      total_tips: initialTipCount,
    });

    return;
  }

  const nextPeakRain = Math.max(ongoing.peak_rain_rate_mmh ?? 0, rainMmHr);
  const nextPeakDepth = Math.max(ongoing.peak_flood_depth_cm ?? 0, floodDepthCm);

  const deltaTicks = computeDeltaTicks({
    currentRainTicksTotal,
    previousRainTicksTotal: ongoing.last_rain_ticks_total,
  });

  const tipDetectedNow = deltaTicks > 0 || tipSignalNow;
  const nextLastTipAt = tipDetectedNow ? timestampIso : (ongoing.last_tip_at ?? null);

  const nextTotalTips = Math.max(
    0,
    (ongoing.total_tips ?? 0) + deltaTicks
  );

  const nextTotalRain = Math.max(
    0,
    (ongoing.total_rain_mm ?? 0) + deltaTicks * MM_PER_TIP
  );

  const recentTip = hasRecentTip(nextLastTipAt, timestampIso);
  const rainRateStillActive = rainMmHr >= EVENT_START_RAIN_MMHR;
  const floodStillActive = floodDepthCm > EVENT_END_DEPTH_CM;

  const shouldStayOngoing =
    overflow || rainRateStillActive || recentTip || floodStillActive;

  if (shouldStayOngoing) {
    await updateRainEvent(ongoing.id, {
      peak_rain_rate_mmh: nextPeakRain,
      peak_flood_depth_cm: nextPeakDepth,
      total_rain_mm: nextTotalRain,
      total_tips: nextTotalTips,
      last_signal_at: timestampIso,
      last_tip_at: nextLastTipAt,
      last_rain_ticks_total: currentRainTicksTotal,
      updated_at: timestampIso,
    });
    return;
  }

  await updateRainEvent(ongoing.id, {
    peak_rain_rate_mmh: nextPeakRain,
    peak_flood_depth_cm: nextPeakDepth,
    total_rain_mm: nextTotalRain,
    total_tips: nextTotalTips,
    last_tip_at: nextLastTipAt,
    last_rain_ticks_total: currentRainTicksTotal,
    status: "resolved",
    ended_at: timestampIso,
    ended_reason: "auto_inactive_rain_and_receded_flood",
    updated_at: timestampIso,
  });
}