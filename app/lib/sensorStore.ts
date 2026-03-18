// app/lib/sensorStore.ts

export type SensorPoint = {
  ts: number; // epoch ms
  deviceId: string;

  // Ultrasonic
  rawDistCm: number; // required (distance-to-surface)
  rawWaterCm?: number | null;
  stableWaterCm?: number | null;

  usValid: boolean;
  acceptedForStable: boolean;
  overflow: boolean;

  // Rain / tipping bucket
  rainTicksTotal?: number | null;
  tips60?: number | null;
  tips300?: number | null;

  rainRateMmHr60?: number | null;
  rainRateMmHr300?: number | null;

  // Connectivity
  rssiDbm?: number | null;

  

  vbatV?: number | null;
  currentMa?: number | null;
  batteryPercentage?: number | null;
  networkType?: string | null;

  // Derived
  dryDistanceCm?: number | null;
  floodDepthCm?: number | null;
};

const MAX_IN_MEMORY = 5000;

// Keep buffer across hot-reloads in dev
const g = globalThis as unknown as {
  __sensorBuffer?: SensorPoint[];
};

if (!g.__sensorBuffer) g.__sensorBuffer = [];

const buffer: SensorPoint[] = g.__sensorBuffer;

function getTsValue(p: Pick<SensorPoint, "ts">): number {
  return Number.isFinite(p.ts) ? p.ts : 0;
}

export async function appendPoint(p: SensorPoint) {
  buffer.push(p);
  buffer.sort((a, b) => getTsValue(a) - getTsValue(b));

  if (buffer.length > MAX_IN_MEMORY) {
    buffer.splice(0, buffer.length - MAX_IN_MEMORY);
  }
}

export function getLatest(): SensorPoint | null {
  if (!buffer.length) return null;
  return buffer[buffer.length - 1];
}

export function getLatestByDevice(deviceId: string): SensorPoint | null {
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (buffer[i].deviceId === deviceId) return buffer[i];
  }
  return null;
}

export function getRecent(limit: number, deviceId?: string | null): SensorPoint[] {
  const n = Math.max(1, Math.min(Math.floor(limit), MAX_IN_MEMORY));

  if (deviceId && deviceId.trim() !== "") {
    const filtered = buffer.filter((p) => p.deviceId === deviceId);
    return filtered.slice(-n);
  }

  return buffer.slice(-n);
}

export function getLatestByAllDevices(): Record<string, SensorPoint> {
  const latestMap = new Map<string, SensorPoint>();

  for (const point of buffer) {
    const prev = latestMap.get(point.deviceId);
    if (!prev || point.ts >= prev.ts) {
      latestMap.set(point.deviceId, point);
    }
  }

  return Object.fromEntries(latestMap.entries());
}