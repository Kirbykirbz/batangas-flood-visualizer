// app/lib/alertsShared.ts

export type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
export type DerivedAlertLevel = "watch" | "warning" | "danger" | "overflow" | null;

export type FloodCategory = "NORMAL" | "WATCH" | "WARNING" | "DANGER" | "OVERFLOW";
export type RainCategory = "NONE" | "LIGHT" | "MODERATE" | "HEAVY" | "VERY_HEAVY" | "EXTREME";
export type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

export const ALERT_THRESHOLDS = {
  floodWatchCm: 10,
  floodWarningCm: 20,
  floodDangerCm: 30,

  rainWatchMmHr: 15,
  rainDangerMmHr: 30,
} as const;

export function classifyFloodCategory(params: {
  floodDepthCm: number;
  overflow: boolean;
}): FloodCategory {
  const { floodDepthCm, overflow } = params;

  if (overflow) return "OVERFLOW";
  if (floodDepthCm >= ALERT_THRESHOLDS.floodDangerCm) return "DANGER";
  if (floodDepthCm >= ALERT_THRESHOLDS.floodWarningCm) return "WARNING";
  if (floodDepthCm >= ALERT_THRESHOLDS.floodWatchCm) return "WATCH";
  return "NORMAL";
}

export function classifyRainCategory(rainMmHr: number): RainCategory {
  const x = Math.max(0, rainMmHr);

  if (x < 0.5) return "NONE";
  if (x < 2.5) return "LIGHT";
  if (x < 7.5) return "MODERATE";
  if (x < 15) return "HEAVY";
  if (x < 30) return "VERY_HEAVY";
  return "EXTREME";
}

export function deriveAlertLevel(params: {
  floodDepthCm: number;
  rainMmHr: number;
  overflow: boolean;
}): DerivedAlertLevel {
  const { floodDepthCm, rainMmHr, overflow } = params;

  if (overflow) return "overflow";

  if (
    floodDepthCm >= ALERT_THRESHOLDS.floodDangerCm ||
    rainMmHr >= ALERT_THRESHOLDS.rainDangerMmHr
  ) {
    return "danger";
  }

  if (floodDepthCm >= ALERT_THRESHOLDS.floodWarningCm) {
    return "warning";
  }

  if (
    floodDepthCm >= ALERT_THRESHOLDS.floodWatchCm ||
    rainMmHr >= ALERT_THRESHOLDS.rainWatchMmHr
  ) {
    return "watch";
  }

  return null;
}

export function mapLevelToSound(level: DerivedAlertLevel | AlertLevel): SoundKey {
  switch (level) {
    case "overflow":
      return "overflow-alarm";
    case "danger":
      return "danger-alarm";
    case "watch":
    case "warning":
      return "warning-soft";
    default:
      return null;
  }
}

export function defaultAlertTitle(params: {
  level: AlertLevel;
  sensorName?: string | null;
}): string {
  const sensorName = params.sensorName?.trim();

  switch (params.level) {
    case "watch":
      return sensorName ? `Flood watch advisory for ${sensorName}` : "Flood watch advisory";
    case "warning":
      return sensorName ? `Flood warning advisory for ${sensorName}` : "Flood warning advisory";
    case "danger":
      return sensorName ? `Danger flood alert for ${sensorName}` : "Danger flood alert";
    case "overflow":
      return sensorName ? `Overflow critical alert for ${sensorName}` : "Overflow critical alert";
    case "info":
    default:
      return sensorName ? `Flood monitoring update for ${sensorName}` : "Flood monitoring update";
  }
}

export function defaultAlertMessage(params: {
  level: AlertLevel;
  sensorName?: string | null;
  floodDepthCm?: number | null;
  rainMmHr?: number | null;
  zoneLabel?: string | null;
}): string {
  const sensorName = params.sensorName?.trim() || "the monitored sensor";
  const zone = params.zoneLabel?.trim();
  const depth =
    params.floodDepthCm != null && Number.isFinite(params.floodDepthCm)
      ? `${params.floodDepthCm.toFixed(1)} cm`
      : "unavailable";
  const rain =
    params.rainMmHr != null && Number.isFinite(params.rainMmHr)
      ? `${params.rainMmHr.toFixed(1)} mm/hr`
      : "unavailable";

  const zoneText = zone ? ` in ${zone}` : "";

  switch (params.level) {
    case "watch":
      return `Watch conditions detected at ${sensorName}${zoneText}. Current flood depth: ${depth}. Current rain intensity: ${rain}. Please stay alert and continue monitoring updates.`;

    case "warning":
      return `Warning conditions detected at ${sensorName}${zoneText}. Current flood depth: ${depth}. Current rain intensity: ${rain}. Prepare for possible flooding and monitor updates closely.`;

    case "danger":
      return `Danger conditions detected at ${sensorName}${zoneText}. Current flood depth: ${depth}. Current rain intensity: ${rain}. Take safety precautions immediately and avoid flood-prone areas.`;

    case "overflow":
      return `Overflow or near-sensor critical water condition detected at ${sensorName}${zoneText}. Current flood depth: ${depth}. Current rain intensity: ${rain}. Immediate attention is strongly advised.`;

    case "info":
    default:
      return `Flood monitoring update for ${sensorName}${zoneText}. Current flood depth: ${depth}. Current rain intensity: ${rain}. Please check the dashboard for details.`;
  }
}