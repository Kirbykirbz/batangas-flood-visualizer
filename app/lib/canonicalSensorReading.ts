// app/lib/canonicalSensorReading.ts

import { toNumber } from "@/app/lib/sensorReading";

type IngestBody = Record<string, unknown>;

export type CanonicalSensorFields = {
  rawDistCm: number | null;
  rawWaterCm: number | null;
  stableWaterCm: number | null;
  usValid: boolean;
  acceptedForStable: boolean;
  overflow: boolean;
  dryDistanceCm: number | null;
  floodDepthCm: number | null;
  rainTicksTotal: number | null;
  tips60: number | null;
  tips300: number | null;
  rainRateMmHr60: number | null;
  rainRateMmHr300: number | null;
  rssiDbm: number | null;
  vbatV: number | null;
  currentMa: number | null;
  batteryPercentage: number | null;
  networkType: string | null;
};

type DeriveOptions = {
  sensorDryDistanceCm: number | null;
  fallbackEnvDryDistanceCm?: number | null;
  mmPerTip: number;
};

type BatteryPoint = {
  v: number;
  p: number;
};

/**
 * Approximate open-circuit state-of-charge curve for a 12V gel / SLA battery.
 * This is still an estimate. Voltage under load or while charging can shift it.
 */
const GEL_12V_CURVE: BatteryPoint[] = [
  { v: 12.73, p: 100 },
  { v: 12.62, p: 90 },
  { v: 12.50, p: 80 },
  { v: 12.37, p: 70 },
  { v: 12.24, p: 60 },
  { v: 12.10, p: 50 },
  { v: 11.96, p: 40 },
  { v: 11.81, p: 30 },
  { v: 11.66, p: 20 },
  { v: 11.51, p: 10 },
  { v: 11.30, p: 0 },
];

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  if (typeof v === "number") return v === 1;
  return false;
}

function nullableNumber(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

function nullableNonNegative(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function batteryPercentFrom12VGel(voltage: number | null): number | null {
  if (voltage == null || !Number.isFinite(voltage)) return null;

  const curve = GEL_12V_CURVE;

  if (voltage >= curve[0].v) return 100;
  if (voltage <= curve[curve.length - 1].v) return 0;

  for (let i = 0; i < curve.length - 1; i++) {
    const high = curve[i];
    const low = curve[i + 1];

    if (voltage <= high.v && voltage >= low.v) {
      const ratio = (voltage - low.v) / (high.v - low.v);
      const percent = low.p + ratio * (high.p - low.p);
      return clamp(0, Math.round(percent), 100);
    }
  }

  return null;
}

export function deriveCanonicalSensorFields(
  body: IngestBody,
  options: DeriveOptions
): CanonicalSensorFields {
  const rawDistCm = num(body.rawDistCm);
  const rawDistOk = Number.isFinite(rawDistCm) && rawDistCm > 0;

  const usValidIn = bool(body.usValid);
  const acceptedForStableIn = bool(body.acceptedForStable);
  const overflowIn = bool(body.overflow);

  const usValid = usValidIn && rawDistOk;
  const acceptedForStable = usValid ? acceptedForStableIn : false;
  const overflow = overflowIn || (rawDistOk && rawDistCm < 20);

  const dryDistanceCm =
    options.sensorDryDistanceCm ??
    options.fallbackEnvDryDistanceCm ??
    null;

  const rawWaterFromServer =
    rawDistOk && dryDistanceCm != null
      ? Math.max(0, dryDistanceCm - rawDistCm)
      : null;

  /**
   * Keep rawWaterCm and stableWaterCm aligned with your current ingest contract:
   * - if device sends them, accept them
   * - otherwise derive them from dryDistanceCm and rawDistCm
   */
  const rawWaterCm =
    nullableNonNegative(body.rawWaterCm) ?? rawWaterFromServer;

  const stableWaterCm =
    nullableNonNegative(body.stableWaterCm) ?? rawWaterFromServer;

  /**
   * Canonical flood depth should only be trusted when the reading is valid
   * and accepted for stable use.
   */
  const floodDepthCm =
    usValid &&
    acceptedForStable &&
    rawDistOk &&
    dryDistanceCm != null
      ? Math.max(0, dryDistanceCm - rawDistCm)
      : null;

  const rainTicksTotal = nullableNonNegative(body.rainTicksTotal);
  const tips60 = nullableNonNegative(body.tips60);
  const tips300 = nullableNonNegative(body.tips300);

  /**
   * mm_per_tip is 0.27 in your project context.
   * 60-second window -> multiply by 60 to annualize to mm/hr
   * 300-second window -> multiply by 12 to annualize to mm/hr
   */
  const rainRateMmHr60 =
    tips60 != null
      ? tips60 * options.mmPerTip * 60
      : nullableNonNegative(body.rainRateMmHr60);

  const rainRateMmHr300 =
    tips300 != null
      ? tips300 * options.mmPerTip * 12
      : nullableNonNegative(body.rainRateMmHr300);

  const rssiDbm = nullableNumber(body.rssiDbm);

  const vbatV = nullableNumber(body.vbatV);
  const currentMa = nullableNumber(body.currentMa);

  /**
   * Prefer explicit batteryPercentage from payload if present.
   * Otherwise compute it from voltage using a 12V gel battery curve.
   */
  const batteryPercentageIn = nullableNumber(body.batteryPercentage);
  const batteryPercentage =
    batteryPercentageIn != null
      ? clamp(0, Math.round(batteryPercentageIn), 100)
      : batteryPercentFrom12VGel(vbatV);

  const networkType =
    typeof body.networkType === "string" && body.networkType.trim() !== ""
      ? body.networkType.trim()
      : null;

  return {
    rawDistCm: rawDistOk ? rawDistCm : null,
    rawWaterCm,
    stableWaterCm,
    usValid,
    acceptedForStable,
    overflow,
    dryDistanceCm,
    floodDepthCm,
    rainTicksTotal,
    tips60,
    tips300,
    rainRateMmHr60,
    rainRateMmHr300,
    rssiDbm,
    vbatV,
    currentMa,
    batteryPercentage,
    networkType,
  };
}

export function nullableEpochMs(v: unknown): number | null {
  const n = toNumber(v);
  return n != null && Number.isFinite(n) ? n : null;
}