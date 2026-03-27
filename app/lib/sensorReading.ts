// app/lib/sensorReading.ts

import type { SensorPoint } from "@/app/lib/sensorStore";

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractTimestampMs(point: SensorPoint | null | undefined): number | null {
  if (!point) return null;
  return Number.isFinite(point.ts) ? point.ts : null;
}

export function extractRainMmHr(point: SensorPoint | null | undefined): number {
  if (!point) return 0;

  return (
    toNumber(point.rainRateMmHr300) ??
    toNumber(point.rainRateMmHr60) ??
    0
  );
}

export function isDepthTrusted(point: SensorPoint | null | undefined): boolean {
  if (!point) return false;
  return point.usValid === true && point.acceptedForStable === true;
}

export function extractFloodDepthCm(point: SensorPoint | null | undefined): number {
  if (!point) return 0;

  // Keep overflow visible to the app, but do not force a fake large depth here.
  // We keep this function conservative and let floodForecast handle escalation later.
  if (!isDepthTrusted(point)) {
    return 0;
  }

  return toNumber(point.floodDepthCm) ?? 0;
}

export function isOverflow(point: SensorPoint | null | undefined): boolean {
  if (!point) return false;
  return point.overflow === true;
}

export function extractDryDistanceCm(point: SensorPoint | null | undefined): number | null {
  if (!point) return null;
  return toNumber(point.dryDistanceCm);
}

export function extractStableWaterCm(point: SensorPoint | null | undefined): number | null {
  if (!point) return null;
  return toNumber(point.stableWaterCm);
}

export function extractBatteryPercentage(point: SensorPoint | null | undefined): number | null {
  if (!point) return null;
  return toNumber(point.batteryPercentage);
}

export function extractRssiDbm(point: SensorPoint | null | undefined): number | null {
  if (!point) return null;
  return toNumber(point.rssiDbm);
}