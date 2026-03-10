// app/lib/sensorStore.ts

export type SensorPoint = {
  ts: number; // epoch ms
  deviceId: string;

  // Ultrasonic
  rawDistCm: number; // required (distance-to-surface)
  rawWaterCm?: number | null; // optional; can be null if not computed/sent
  stableWaterCm?: number | null;

  usValid: boolean;
  acceptedForStable: boolean;
  overflow: boolean;

  // Rain / tipping bucket
  // NOTE: Prefer mm-per-tip = 0.2 mm/tip in your CLIENT/UI and any server-side derivations.
  rainTicksTotal?: number | null;
  tips60?: number | null;
  tips300?: number | null;

  rainRateMmHr60?: number | null;
  rainRateMmHr300?: number | null;

  // Connectivity
  rssiDbm?: number | null;

  // Derived (computed on server)
  dryDistanceCm?: number | null; // from env DRY_DISTANCE_CM
  floodDepthCm?: number | null;  // max(0, dryDistanceCm - rawDistCm)
};

const MAX_IN_MEMORY = 5000;

// Keep the buffer across hot-reloads in dev
const g = globalThis as unknown as { __sensorBuffer?: SensorPoint[] };
if (!g.__sensorBuffer) g.__sensorBuffer = [];
const buffer: SensorPoint[] = g.__sensorBuffer;

export async function appendPoint(p: SensorPoint) {
  buffer.push(p);
  if (buffer.length > MAX_IN_MEMORY) buffer.splice(0, buffer.length - MAX_IN_MEMORY);
}

export function getLatest(): SensorPoint | null {
  return buffer.length ? buffer[buffer.length - 1] : null;
}

export function getRecent(limit: number): SensorPoint[] {
  const n = Math.max(1, Math.min(limit, MAX_IN_MEMORY));
  return buffer.slice(-n);
}