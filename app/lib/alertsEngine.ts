import type { SensorPoint } from "@/app/lib/sensorStore";
import {
  createAlert,
  getLatestUnresolvedAlertByDevice,
  resolveAlert,
} from "@/app/lib/alertsRepo";
import { getOngoingRainEvent } from "@/app/lib/eventsRepo";
import { sendPushAlert } from "@/app/lib/pushNotifier";
import {
  extractFloodDepthCm,
  extractRainMmHr,
  extractTimestampMs,
  isOverflow,
} from "@/app/lib/sensorReading";

export type DerivedAlertLevel = "watch" | "warning" | "danger" | "overflow" | null;

const WATCH_RAIN_MMHR = 15;
const EXTREME_RAIN_MMHR = 30;

const WATCH_DEPTH_CM = 30.48;
const WARNING_DEPTH_CM = 60.96;
const DANGER_DEPTH_CM = 121.92;

function deriveAlertLevel(point: SensorPoint): DerivedAlertLevel {
  const overflow = isOverflow(point);
  const floodDepthCm = extractFloodDepthCm(point);
  const rainMmHr = extractRainMmHr(point);

  if (overflow) return "overflow";

  // Severe alert can come from EITHER extreme rain OR high flood depth
  if (floodDepthCm >= DANGER_DEPTH_CM || rainMmHr >= EXTREME_RAIN_MMHR) {
    return "danger";
  }

  if (floodDepthCm >= WARNING_DEPTH_CM) {
    return "warning";
  }

  if (floodDepthCm >= WATCH_DEPTH_CM || rainMmHr >= WATCH_RAIN_MMHR) {
    return "watch";
  }

  return null;
}

function buildAlertTitle(level: Exclude<DerivedAlertLevel, null>, point: SensorPoint) {
  const deviceId = point.deviceId ?? "unknown sensor";

  switch (level) {
    case "overflow":
      return `Overflow detected at ${deviceId}`;
    case "danger":
      return `Danger alert at ${deviceId}`;
    case "warning":
      return `Warning alert at ${deviceId}`;
    case "watch":
      return `Flood watch at ${deviceId}`;
  }
}

function buildAlertMessage(level: Exclude<DerivedAlertLevel, null>, point: SensorPoint) {
  const rainMmHr = extractRainMmHr(point);
  const floodDepthCm = extractFloodDepthCm(point);
  const overflow = isOverflow(point);

  switch (level) {
    case "overflow":
      return `Overflow or near-sensor critical water condition detected. Rain: ${rainMmHr.toFixed(
        1
      )} mm/hr. Flood depth: ${floodDepthCm.toFixed(1)} cm. Overflow: ${
        overflow ? "Yes" : "No"
      }.`;

    case "danger":
      if (floodDepthCm >= DANGER_DEPTH_CM && rainMmHr >= EXTREME_RAIN_MMHR) {
        return `Danger conditions detected from both extreme rainfall and high flood depth. Rain: ${rainMmHr.toFixed(
          1
        )} mm/hr. Flood depth: ${floodDepthCm.toFixed(1)} cm.`;
      }

      if (floodDepthCm >= DANGER_DEPTH_CM) {
        return `Danger flood depth detected at ${floodDepthCm.toFixed(
          1
        )} cm. Rain intensity: ${rainMmHr.toFixed(1)} mm/hr.`;
      }

      return `Extreme rainfall detected at ${rainMmHr.toFixed(
        1
      )} mm/hr. Flood depth: ${floodDepthCm.toFixed(1)} cm.`;

    case "warning":
      return `Warning flood depth detected at ${floodDepthCm.toFixed(
        1
      )} cm. Rain intensity: ${rainMmHr.toFixed(1)} mm/hr.`;

    case "watch":
      return `Watch conditions detected. Rain: ${rainMmHr.toFixed(
        1
      )} mm/hr. Flood depth: ${floodDepthCm.toFixed(1)} cm.`;
  }
}

function severityRank(level: DerivedAlertLevel | "info"): number {
  switch (level) {
    case "overflow":
      return 4;
    case "danger":
      return 3;
    case "warning":
      return 2;
    case "watch":
      return 1;
    case "info":
      return 0;
    default:
      return 0;
  }
}

function shouldSendPushForLevel(level: DerivedAlertLevel): boolean {
  return level === "danger" || level === "overflow";
}

async function createAlertAndMaybePush(params: {
  deviceId: string;
  level: Exclude<DerivedAlertLevel, null>;
  point: SensorPoint;
  rainEventId: number | null;
}) {
  const { deviceId, level, point, rainEventId } = params;

  const createdAlert = await createAlert({
    device_id: deviceId,
    rain_event_id: rainEventId,
    level,
    title: buildAlertTitle(level, point),
    message: buildAlertMessage(level, point),
  });

  if (shouldSendPushForLevel(level)) {
    await sendPushAlert({
      title: createdAlert.title,
      message: createdAlert.message,
      url: "/dashboard/admin/alerts",
      deviceId,
    });
  }

  return createdAlert;
}

export async function processAlertsForReading(point: SensorPoint) {
  const deviceId = point.deviceId;
  const tsMs = extractTimestampMs(point);

  if (!deviceId || !tsMs) return;

  const timestampIso = new Date(tsMs).toISOString();
  const nextLevel = deriveAlertLevel(point);
  const latestAlert = await getLatestUnresolvedAlertByDevice(deviceId);
  const ongoingEvent = await getOngoingRainEvent(deviceId);

  if (!nextLevel) {
    if (latestAlert) {
      await resolveAlert(latestAlert.id, timestampIso);
    }
    return;
  }

  if (!latestAlert) {
    await createAlertAndMaybePush({
      deviceId,
      level: nextLevel,
      point,
      rainEventId: ongoingEvent?.id ?? null,
    });
    return;
  }

  if (latestAlert.level === nextLevel) {
    return;
  }

  const previousRank = severityRank(latestAlert.level);
  const nextRank = severityRank(nextLevel);

  await resolveAlert(latestAlert.id, timestampIso);

  await createAlertAndMaybePush({
    deviceId,
    level: nextLevel,
    point,
    rainEventId: ongoingEvent?.id ?? null,
  });

  void previousRank;
  void nextRank;
}