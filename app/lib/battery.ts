export type BatteryPoint = {
  v: number;
  p: number;
};

/**
 * Approximate open-circuit state-of-charge curve for 12V gel / sealed lead-acid battery.
 * This is still an estimate. Voltage under load or while charging will distort the result.
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

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function batteryPercentFrom12VGel(
  voltage: number | null | undefined
): number | null {
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

export function batteryHealthLabel(
  percent: number | null | undefined
): "unknown" | "critical" | "low" | "medium" | "good" | "high" {
  if (percent == null || !Number.isFinite(percent)) return "unknown";
  if (percent <= 10) return "critical";
  if (percent <= 30) return "low";
  if (percent <= 60) return "medium";
  if (percent <= 85) return "good";
  return "high";
}