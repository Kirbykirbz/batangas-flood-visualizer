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

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
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

  const rawWaterCm =
    nullableNonNegative(body.rawWaterCm) ?? rawWaterFromServer;

  const stableWaterCm =
    nullableNonNegative(body.stableWaterCm) ?? rawWaterFromServer;

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
  const batteryPercentage = nullableNumber(body.batteryPercentage);
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