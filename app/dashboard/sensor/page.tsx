// app/dashboard/sensor/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type AnyPoint = Record<string, unknown>;
type ForecastHorizon = "now" | "2h" | "4h" | "6h" | "8h";

type SensorOption = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

const SENSORS: SensorOption[] = [
  {
    id: "esp32-1",
    name: "Sensor 1",
    lat: 13.735412678211276,
    lng: 121.07296804092847,
  },
  {
    id: "esp32-2",
    name: "Sensor 2",
    lat: 13.77057650804614,
    lng: 121.06549040352245,
  },
  {
    id: "esp32-3",
    name: "Sensor 3",
    lat: 13.751630736945645,
    lng: 121.07199671425865,
  },
];

type NormalizedPoint = {
  tsMs: number | null;
  deviceId: string | null;

  rawDistCm: number | null;
  rawWaterCm: number | null;
  stableWaterCm: number | null;

  usValid: boolean | null;
  acceptedForStable: boolean | null;
  overflow: boolean | null;

  rainTicksTotal: number | null;
  tips60: number | null;
  tips300: number | null;
  rainRateMmHr60: number | null;
  rainRateMmHr300: number | null;

  rssiDbm: number | null;

  dryDistanceCm: number | null;
  floodDepthCm: number | null;

  rainMm60: number | null;
  rainMm300: number | null;

  hasTs: boolean;
  isStale: boolean;
};

type Payload = {
  latest: AnyPoint | null;
  recent: AnyPoint[];
  latestByDevice?: Record<string, AnyPoint>;
  serverTime: number;
};

type FloodStatus = {
  label: "NORMAL" | "WATCH" | "WARNING" | "DANGER";
  note: string;
};

type RainStatus = {
  label: "NONE" | "LIGHT" | "MODERATE" | "HEAVY" | "VERY HEAVY" | "EXTREME";
  note: string;
  mmHr: number;
};

type WeatherPayload = {
  fetchedAt: number;
  lat: number;
  lng: number;
  timezone: string;
  current: {
    time: string | null;
    precipitation_mm: number | null;
    rain_mm: number | null;
  };
  hourly: {
    time: string[];
    precipitation_mm: number[];
    rain_mm: number[];
    precip_prob: number[];
  };
};

type WeatherApiResponse =
  | { ok: true; source: "live" | "cache"; data: WeatherPayload }
  | { ok: false; error: string; detail?: string };

function forecastHours(h: ForecastHorizon): number {
  switch (h) {
    case "2h":
      return 2;
    case "4h":
      return 4;
    case "6h":
      return 6;
    case "8h":
      return 8;
    default:
      return 0;
  }
}

function classifyFloodFt(waterFt: number): FloodStatus {
  if (waterFt >= 3) return { label: "DANGER", note: "High water level (≥ 3 ft)" };
  if (waterFt >= 2) return { label: "WARNING", note: "Rising water level (≥ 2 ft)" };
  if (waterFt >= 1) return { label: "WATCH", note: "Water level watch (≥ 1 ft)" };
  return { label: "NORMAL", note: "Normal water level" };
}

function classifyRainMmHr(
  mmHr: number,
  opts?: { tips?: number | null; windowLabel?: "60s" | "5m" }
): RainStatus {
  const x = Math.max(0, mmHr);
  const tips = Math.max(0, opts?.tips ?? 0);

  if (tips <= 1) {
    if (x < 0.5) {
      return {
        label: "NONE",
        note: `< 0.5 mm/hr (low sample${opts?.windowLabel ? `, ${opts.windowLabel}` : ""})`,
        mmHr: x,
      };
    }
    return {
      label: "LIGHT",
      note: `Low sample (${tips} tip${tips === 1 ? "" : "s"}${
        opts?.windowLabel ? `, ${opts.windowLabel}` : ""
      })`,
      mmHr: x,
    };
  }

  if (x < 0.5) return { label: "NONE", note: "< 0.5 mm/hr", mmHr: x };
  if (x < 2.5) return { label: "LIGHT", note: "0.5–2.5 mm/hr", mmHr: x };
  if (x < 7.5) return { label: "MODERATE", note: "2.5–7.5 mm/hr", mmHr: x };
  if (x < 15) return { label: "HEAVY", note: "7.5–15 mm/hr", mmHr: x };
  if (x < 30) return { label: "VERY HEAVY", note: "15–30 mm/hr", mmHr: x };
  return { label: "EXTREME", note: "≥ 30 mm/hr", mmHr: x };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return null;
}

function toTsMs(v: unknown): number | null {
  const n = toNumber(v);
  if (n != null) {
    if (n > 1e12) return Math.round(n);
    if (n > 1e9) return Math.round(n * 1000);
    return null;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function fmtTime(tsMs: number | null) {
  if (!tsMs) return "—";
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusBadgeClasses(label: FloodStatus["label"]) {
  switch (label) {
    case "DANGER":
      return "bg-red-600 text-white";
    case "WARNING":
      return "bg-amber-600 text-white";
    case "WATCH":
      return "bg-blue-600 text-white";
    default:
      return "bg-emerald-700 text-white";
  }
}

function rainBadgeClasses(label: RainStatus["label"]) {
  switch (label) {
    case "EXTREME":
      return "bg-red-700 text-white";
    case "VERY HEAVY":
      return "bg-red-600 text-white";
    case "HEAVY":
      return "bg-amber-600 text-white";
    case "MODERATE":
      return "bg-blue-600 text-white";
    case "LIGHT":
      return "bg-sky-700 text-white";
    default:
      return "bg-zinc-700 text-white";
  }
}

function pillClasses(tone: "ok" | "warn" | "bad" | "neutral") {
  switch (tone) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "warn":
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
    case "bad":
      return "bg-red-50 text-red-800 ring-1 ring-red-200";
    default:
      return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
  }
}

function normalizePoint(p: AnyPoint, nowMs: number): NormalizedPoint {
  const tsMs = toTsMs(p.ts) ?? toTsMs(p.created_at) ?? toTsMs(p.time) ?? null;
  const deviceId =
    (typeof p.deviceId === "string" ? p.deviceId : null) ??
    (typeof p.device_id === "string" ? p.device_id : null);

  const rawDistRaw = toNumber(p.rawDistCm) ?? toNumber(p.raw_dist_cm) ?? null;
  const rawDistCm = rawDistRaw != null && rawDistRaw > 0 ? rawDistRaw : null;

  const rawWaterCm =
    toNumber(p.rawWaterCm) ??
    toNumber(p.raw_water_cm) ??
    toNumber(p.waterCm) ??
    toNumber(p.water_cm) ??
    null;

  const stableWaterCm =
    toNumber(p.stableWaterCm) ?? toNumber(p.stable_water_cm) ?? rawWaterCm;

  const usValid = toBool(p.usValid) ?? toBool(p.us_valid) ?? null;
  const acceptedForStable =
    toBool(p.acceptedForStable) ?? toBool(p.accepted_for_stable) ?? null;
  const overflow = toBool(p.overflow) ?? null;

  const rainTicksTotal =
    toNumber(p.rainTicksTotal) ?? toNumber(p.rain_ticks_total) ?? null;
  const tips60 = toNumber(p.tips60) ?? toNumber(p.tips_60) ?? null;
  const tips300 = toNumber(p.tips300) ?? toNumber(p.tips_300) ?? null;

  const rainRateMmHr60 =
    toNumber(p.rainRateMmHr60) ?? toNumber(p.rain_rate_mmh_60) ?? null;
  const rainRateMmHr300 =
    toNumber(p.rainRateMmHr300) ?? toNumber(p.rain_rate_mmh_300) ?? null;

  const rssiDbm = toNumber(p.rssiDbm) ?? toNumber(p.rssi_dbm) ?? null;

  const dryDistanceCm =
    toNumber(p.dryDistanceCm) ?? toNumber(p.dry_distance_cm) ?? null;
  const floodDepthCm =
    toNumber(p.floodDepthCm) ?? toNumber(p.flood_depth_cm) ?? null;

  const MM_PER_TIP = 0.327;
  const rainMm60 = tips60 != null ? tips60 * MM_PER_TIP : null;
  const rainMm300 = tips300 != null ? tips300 * MM_PER_TIP : null;

  const STALE_MS = 15_000;
  const hasTs = tsMs != null;
  const isStale = hasTs ? nowMs - tsMs > STALE_MS : true;

  return {
    tsMs,
    deviceId,

    rawDistCm,
    rawWaterCm: rawWaterCm != null && rawWaterCm >= 0 ? rawWaterCm : null,
    stableWaterCm: stableWaterCm != null && stableWaterCm >= 0 ? stableWaterCm : null,

    usValid,
    acceptedForStable,
    overflow,

    rainTicksTotal,
    tips60,
    tips300,
    rainRateMmHr60,
    rainRateMmHr300,

    rssiDbm,

    dryDistanceCm,
    floodDepthCm,

    rainMm60,
    rainMm300,

    hasTs,
    isStale,
  };
}

export default function SensorDashboardPage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("esp32-1");
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>("now");

  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [weatherError, setWeatherError] = useState<string>("");

  const POLL_LATEST_MS = 1000;
  const POLL_LOGS_MS = 5000;

  const CM_PER_FT = 30.48;
  const MM_PER_TIP = 0.327;
  const DEPTH_ON_CM = 5;

  const [latestRaw, setLatestRaw] = useState<AnyPoint | null>(null);
  const [recentRaw, setRecentRaw] = useState<AnyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [lastFetchAt, setLastFetchAt] = useState<number>(0);
  const [showLogs, setShowLogs] = useState(false);

  const inFlightLatestRef = useRef(false);
  const inFlightLogsRef = useRef(false);

  const selectedSensor = useMemo(
    () => SENSORS.find((s) => s.id === selectedDeviceId) ?? SENSORS[0],
    [selectedDeviceId]
  );

  function downloadFile(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleDownloadCsv() {
    const url = `/api/report/export?deviceId=${encodeURIComponent(
      selectedDeviceId
    )}&format=csv&limit=5000`;
    downloadFile(url);
  }

  function handleDownloadJson() {
    const url = `/api/report/export?deviceId=${encodeURIComponent(
      selectedDeviceId
    )}&format=json&limit=5000`;
    downloadFile(url);
  }

  async function loadLatestOnly() {
    if (inFlightLatestRef.current) return;
    inFlightLatestRef.current = true;

    try {
      const res = await fetch(`/api/data?limit=600&t=${Date.now()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json: Payload = await res.json();

      const selectedLatest =
        json.latestByDevice?.[selectedDeviceId] ??
        json.recent.find((p) => {
          const id =
            (typeof p.deviceId === "string" ? p.deviceId : null) ??
            (typeof p.device_id === "string" ? p.device_id : null);
          return id === selectedDeviceId;
        }) ??
        json.latest ??
        null;

      setLatestRaw(selectedLatest);
      setRecentRaw(Array.isArray(json.recent) ? json.recent : []);
      setError("");
      setLastFetchAt(Date.now());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
      inFlightLatestRef.current = false;
    }
  }

  async function loadLogs() {
    if (inFlightLogsRef.current) return;
    inFlightLogsRef.current = true;

    try {
      const res = await fetch(`/api/data?limit=600&t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json: Payload = await res.json();
      setRecentRaw(Array.isArray(json.recent) ? json.recent : []);
    } catch (e) {
      console.error("Failed to load logs:", e);
    } finally {
      inFlightLogsRef.current = false;
    }
  }

  useEffect(() => {
    loadLatestOnly();
    const id = setInterval(loadLatestOnly, POLL_LATEST_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!showLogs) return;
    loadLogs();
    const id = setInterval(loadLogs, POLL_LOGS_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogs, selectedDeviceId]);

  const nowMs = Date.now();

  const latest = useMemo(() => {
    return latestRaw ? normalizePoint(latestRaw, nowMs) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRaw, lastFetchAt]);

  const recent = useMemo(() => {
    if (!showLogs) return [] as NormalizedPoint[];

    const filtered = (recentRaw ?? []).filter((p) => {
      const id =
        (typeof p.deviceId === "string" ? p.deviceId : null) ??
        (typeof p.device_id === "string" ? p.device_id : null);
      return id === selectedDeviceId;
    });

    const arr = filtered.map((p) => normalizePoint(p, nowMs));
    const withTs = arr.filter((x) => x.tsMs != null) as Array<
      NormalizedPoint & { tsMs: number }
    >;

    if (withTs.length >= 2) {
      withTs.sort((a, b) => a.tsMs - b.tsMs);
      return withTs;
    }

    return arr;
  }, [recentRaw, showLogs, nowMs, selectedDeviceId]);

  const WX_POLL_MS = 60_000;
  const WX_LAT = selectedSensor.lat;
  const WX_LNG = selectedSensor.lng;

  async function loadWeather() {
    try {
      const res = await fetch(
        `/api/weather?lat=${WX_LAT}&lng=${WX_LNG}&t=${Date.now()}`,
        {
          cache: "no-store",
        }
      );
      const json = (await res.json()) as WeatherApiResponse;

      if (!json.ok) {
        setWeather(null);
        setWeatherError(json.detail ? `${json.error}: ${json.detail}` : json.error);
        return;
      }

      setWeather(json.data);
      setWeatherError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setWeather(null);
      setWeatherError(msg);
    }
  }

  useEffect(() => {
    loadWeather();
    const id = setInterval(loadWeather, WX_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  const stableWaterFt = useMemo(() => {
    if (!latest?.stableWaterCm && latest?.stableWaterCm !== 0) return null;
    return (latest.stableWaterCm ?? 0) / CM_PER_FT;
  }, [latest]);

  const flood = classifyFloodFt(stableWaterFt ?? 0);

  const rainStatus = useMemo(() => {
    const has300 = latest?.rainRateMmHr300 != null;
    const mmHr = has300 ? (latest!.rainRateMmHr300 as number) : latest?.rainRateMmHr60 ?? 0;
    const tips = has300 ? latest?.tips300 ?? 0 : latest?.tips60 ?? 0;
    const windowLabel = has300 ? "5m" : "60s";
    return classifyRainMmHr(mmHr, { tips, windowLabel });
  }, [latest]);

  const forecastScenario = useMemo(() => {
    const currentRain = latest?.rainRateMmHr300 ?? latest?.rainRateMmHr60 ?? 0;
    const currentDepth = latest?.floodDepthCm ?? 0;

    if (forecastHorizon === "now") {
      return {
        rainMmHr: currentRain,
        floodDepthCm: currentDepth,
      };
    }

    const hours = forecastHours(forecastHorizon);
    const projectedRainMm = currentRain * hours;
    const projectedDepth = Math.max(currentDepth, currentDepth + projectedRainMm * 0.35);

    return {
      rainMmHr: currentRain,
      floodDepthCm: projectedDepth,
    };
  }, [latest, forecastHorizon]);

  const forecastRainStatus = useMemo(() => {
    const tips = latest?.tips300 ?? latest?.tips60 ?? 0;
    return classifyRainMmHr(forecastScenario.rainMmHr, { tips, windowLabel: "5m" });
  }, [forecastScenario, latest]);

  const dataQuality = useMemo(() => {
    if (!latest) return { label: "NO DATA", tone: "bad" as const, note: "No latest reading" };
    if (!latest.hasTs) return { label: "NO TS", tone: "bad" as const, note: "Missing timestamp" };
    if (latest.isStale) return { label: "STALE", tone: "warn" as const, note: "No update in 15s" };
    return { label: "LIVE", tone: "ok" as const, note: "Fresh readings" };
  }, [latest]);

  const activation = useMemo(() => {
    if (!latest || latest.isStale) {
      return {
        on: false,
        reason: "Data stale/offline: activation forced OFF",
      };
    }

    const tipsOn = (latest.tips60 ?? 0) > 0;
    const depthOn = forecastScenario.floodDepthCm >= DEPTH_ON_CM;

    if (tipsOn && depthOn) return { on: true, reason: "Raining now (tips60 > 0) + depth above threshold" };
    if (tipsOn) return { on: true, reason: "Raining now (tips60 > 0)" };
    if (depthOn) {
      return {
        on: true,
        reason: `Flood depth ≥ ${DEPTH_ON_CM} cm (post-rain persistence / forecast)`,
      };
    }
    return { on: false, reason: "No rain tips and flood depth below threshold" };
  }, [latest, forecastScenario]);

  const secondsSinceFetch = lastFetchAt
    ? Math.floor((Date.now() - lastFetchAt) / 1000)
    : null;

  const healthPills = useMemo(() => {
    const pills: Array<{ text: string; tone: "ok" | "warn" | "bad" | "neutral" }> = [];
    if (!latest) return pills;

    pills.push({
      text: latest.isStale ? "STALE" : "LIVE",
      tone: latest.isStale ? "warn" : "ok",
    });

    pills.push({
      text: latest.usValid === false ? "Ultrasonic invalid" : "Ultrasonic OK",
      tone: latest.usValid === false ? "warn" : "ok",
    });

    pills.push({
      text: latest.acceptedForStable === false ? "Spike ignored" : "Stable update OK",
      tone: latest.acceptedForStable === false ? "warn" : "ok",
    });

    pills.push({
      text: latest.overflow ? "Overflow / too close" : "No overflow",
      tone: latest.overflow ? "bad" : "ok",
    });

    pills.push({
      text: activation.on ? "Activation ON" : "Activation OFF",
      tone: activation.on ? "warn" : "neutral",
    });

    if (latest.rssiDbm != null) {
      pills.push({
        text: `Signal ${fmtInt(latest.rssiDbm)} dBm`,
        tone: latest.rssiDbm < -85 ? "warn" : "neutral",
      });
    } else {
      pills.push({ text: "Signal —", tone: "neutral" });
    }

    return pills;
  }, [latest, activation.on]);

  const reportSummary = useMemo(() => {
    const tips60 = latest?.tips60 ?? null;
    const tips300 = latest?.tips300 ?? null;
    const rainMm300 = latest?.rainMm300 ?? null;

    const depth = forecastScenario.floodDepthCm ?? null;
    const dryDist = latest?.dryDistanceCm ?? null;
    const rawDist = latest?.rawDistCm ?? null;

    const fresh = latest ? !latest.isStale : false;

    return {
      freshness: fresh ? "Live telemetry received." : "Telemetry stale/offline (no recent update).",
      rain: `Rain intensity: ${forecastRainStatus.label} (${fmt(
        forecastRainStatus.mmHr,
        1
      )} mm/hr). Tips60=${tips60 ?? "—"}, Tips300=${tips300 ?? "—"}, Rain300=${
        rainMm300 != null ? fmt(rainMm300, 2) : "—"
      } mm.`,
      depth: `Flood depth (current / scenario): ${
        depth != null ? fmt(depth, 1) : "—"
      } cm. Dry distance=${dryDist != null ? fmt(dryDist, 1) : "—"} cm, Raw distance=${
        rawDist != null ? fmt(rawDist, 1) : "—"
      } cm.`,
      activation: `Map activation: ${activation.on ? "ON" : "OFF"} — ${activation.reason}.`,
      waterStatus: `Water-level status: ${flood.label} — ${flood.note}.`,
    };
  }, [latest, activation, forecastRainStatus, flood, forecastScenario]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-zinc-500">Loading live data…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-base font-extrabold">Error</div>
          <div className="mt-2 text-sm text-zinc-700">{error}</div>
          <button
            className="mt-4 inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-zinc-50"
            onClick={loadLatestOnly}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stableCm = latest?.stableWaterCm ?? null;
  const floodDepthCm = forecastScenario.floodDepthCm ?? null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            ← Back to Dashboard
          </Link>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span>Sensor</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
              >
                {SENSORS.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span>Forecast</span>
              <select
                value={forecastHorizon}
                onChange={(e) => setForecastHorizon(e.target.value as ForecastHorizon)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
              >
                <option value="now">Now</option>
                <option value="2h">2 Hours</option>
                <option value="4h">4 Hours</option>
                <option value="6h">6 Hours</option>
                <option value="8h">8 Hours</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-extrabold text-zinc-900">Weather (Open-Meteo)</div>
              <div className="mt-1 text-xs text-zinc-500">
                {selectedSensor.name} • Location: {WX_LAT.toFixed(5)}, {WX_LNG.toFixed(5)} •
                Timezone: Asia/Manila
              </div>
            </div>

            <button
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-gray-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-gray-800"
              onClick={loadWeather}
              type="button"
            >
              Refresh
            </button>
          </div>

          {weatherError ? (
            <div className="mt-3 text-sm text-red-700">{weatherError}</div>
          ) : !weather ? (
            <div className="mt-3 text-sm text-zinc-600">Loading weather…</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Current precipitation</div>
                <div className="mt-1 text-2xl font-extrabold text-zinc-900">
                  {weather.current.precipitation_mm == null
                    ? "—"
                    : `${weather.current.precipitation_mm.toFixed(1)} mm`}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Updated: {new Date(weather.fetchedAt).toLocaleString()}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Next 1 hour (forecast)</div>
                <div className="mt-1 text-2xl font-extrabold text-zinc-900">
                  {weather.hourly.precipitation_mm?.[0] != null
                    ? `${Number(weather.hourly.precipitation_mm[0]).toFixed(1)} mm`
                    : "—"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Probability:{" "}
                  {weather.hourly.precip_prob?.[0] != null
                    ? `${Math.round(weather.hourly.precip_prob[0])}%`
                    : "—"}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Next 3 hours (sum)</div>
                <div className="mt-1 text-2xl font-extrabold text-zinc-900">
                  {weather.hourly.precipitation_mm?.length >= 3
                    ? `${(
                        Number(weather.hourly.precipitation_mm[0] ?? 0) +
                        Number(weather.hourly.precipitation_mm[1] ?? 0) +
                        Number(weather.hourly.precipitation_mm[2] ?? 0)
                      ).toFixed(1)} mm`
                    : "—"}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mt-2 text-3xl font-semibold uppercase tracking-wide text-zinc-500">
              Flood Monitoring
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Sensor Dashboard — {selectedSensor.name}
            </h1>
            <div className="mt-2 text-sm text-zinc-600">
              <span className="font-semibold">Forecast mode:</span>{" "}
              {forecastHorizon === "now" ? "Live / Current" : `+${forecastHorizon}`}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              <span className="font-semibold">Latest:</span> {fmtTime(latest?.tsMs ?? null)}
              {secondsSinceFetch != null ? (
                <span className="text-zinc-500"> • Updated {secondsSinceFetch}s ago</span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`rounded-full px-4 py-2 text-xs font-extrabold ${statusBadgeClasses(
                flood.label
              )}`}
            >
              {flood.label}
              <span className="ml-2 font-semibold opacity-90">• {flood.note}</span>
            </div>

            <div
              className={`rounded-full px-4 py-2 text-xs font-extrabold ${rainBadgeClasses(
                forecastRainStatus.label
              )}`}
            >
              RAIN {forecastRainStatus.label}
              <span className="ml-2 font-semibold opacity-90">• {forecastRainStatus.note}</span>
            </div>

            <span
              className={`rounded-full px-4 py-2 text-xs font-extrabold ${pillClasses(
                dataQuality.tone
              )}`}
              title={dataQuality.note}
            >
              {dataQuality.label}
            </span>

            <button
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-gray-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-gray-800"
              onClick={loadLatestOnly}
              type="button"
            >
              Refresh
            </button>

            <button
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={handleDownloadCsv}
              type="button"
            >
              Download CSV
            </button>

            <button
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={handleDownloadJson}
              type="button"
            >
              Download JSON
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Stable water level</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {stableWaterFt != null ? `${fmt(stableWaterFt, 2)} ft` : "—"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              {stableCm != null ? `${fmt(stableCm, 1)} cm (filtered)` : "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              Flood depth ({forecastHorizon === "now" ? "current" : `forecast ${forecastHorizon}`})
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {floodDepthCm != null ? `${fmt(floodDepthCm, 1)} cm` : "—"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              DryDist:{" "}
              {latest?.dryDistanceCm != null ? `${fmt(latest.dryDistanceCm, 1)} cm` : "—"} •
              RawDist: {latest?.rawDistCm != null ? `${fmt(latest.rawDistCm, 1)} cm` : "—"}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Rain rate (5 min)</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {latest?.rainRateMmHr300 != null ? `${fmt(latest.rainRateMmHr300, 1)} mm/hr` : "—"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              Tips300: {latest?.tips300 != null ? fmtInt(latest.tips300) : "—"} • Rain300:{" "}
              {latest?.rainMm300 != null ? `${fmt(latest.rainMm300, 2)} mm` : "—"} • {MM_PER_TIP}{" "}
              mm/tip
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Activation (map)</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {activation.on ? "ON" : "OFF"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">{activation.reason}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-base font-extrabold text-zinc-900">Sensor health</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {healthPills.map((p) => (
                    <span
                      key={p.text}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${pillClasses(
                        p.tone
                      )}`}
                    >
                      {p.text}
                    </span>
                  ))}
                </div>

                <div className="mt-3 text-xs text-zinc-500">
                  Notes: <span className="font-semibold">STALE</span> means the device is not
                  sending recent records. Activation uses{" "}
                  <span className="font-semibold">tips60</span> or{" "}
                  <span className="font-semibold">floodDepthCm ≥ {DEPTH_ON_CM}</span>.
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 sm:min-w-[260px]">
                <div className="text-xs font-semibold text-zinc-500">Key raw signals</div>
                <div className="mt-2 space-y-1 text-xs text-zinc-700">
                  <div>
                    rawDistCm:{" "}
                    <span className="font-bold">
                      {latest?.rawDistCm != null ? fmt(latest.rawDistCm, 1) : "—"}
                    </span>
                  </div>
                  <div>
                    usValid:{" "}
                    <span className="font-bold">
                      {latest?.usValid == null ? "—" : latest.usValid ? "true" : "false"}
                    </span>
                  </div>
                  <div>
                    acceptedForStable:{" "}
                    <span className="font-bold">
                      {latest?.acceptedForStable == null
                        ? "—"
                        : latest.acceptedForStable
                        ? "true"
                        : "false"}
                    </span>
                  </div>
                  <div>
                    tips60:{" "}
                    <span className="font-bold">
                      {latest?.tips60 != null ? fmtInt(latest.tips60) : "—"}
                    </span>
                  </div>
                  <div>
                    rainRate300:{" "}
                    <span className="font-bold">
                      {latest?.rainRateMmHr300 != null ? fmt(latest.rainRateMmHr300, 1) : "—"}
                    </span>{" "}
                    mm/hr
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-base font-extrabold text-zinc-900">Rain details</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-zinc-500">Tips (60s)</dt>
              <dd className="text-right font-bold text-zinc-900">{fmtInt(latest?.tips60 ?? null)}</dd>

              <dt className="text-zinc-500">Rain (60s)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainMm60 != null ? `${fmt(latest.rainMm60, 2)} mm` : "—"}
              </dd>

              <dt className="text-zinc-500">Tips (5m)</dt>
              <dd className="text-right font-bold text-zinc-900">{fmtInt(latest?.tips300 ?? null)}</dd>

              <dt className="text-zinc-500">Rain (5m)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainMm300 != null ? `${fmt(latest.rainMm300, 2)} mm` : "—"}
              </dd>

              <dt className="text-zinc-500">Rate (60s)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainRateMmHr60 != null ? `${fmt(latest.rainRateMmHr60, 1)} mm/hr` : "—"}
              </dd>

              <dt className="text-zinc-500">Rate (5m)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainRateMmHr300 != null
                  ? `${fmt(latest.rainRateMmHr300, 1)} mm/hr`
                  : "—"}
              </dd>

              <dt className="text-zinc-500">Total ticks</dt>
              <dd className="text-right font-bold text-zinc-900">
                {fmtInt(latest?.rainTicksTotal ?? null)}
              </dd>

              <dt className="text-zinc-500">Signal</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rssiDbm != null ? `${fmtInt(latest.rssiDbm)} dBm` : "—"}
              </dd>
            </dl>

            <div className="mt-3 text-xs text-zinc-500">
              Calibration: {MM_PER_TIP} mm/tip (tipping bucket). Intensity uses 5-minute rate when
              available.
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-base font-extrabold text-zinc-900">Report summary</div>
              <div className="mt-1 text-xs text-zinc-500">
                Summary for {selectedSensor.name} under{" "}
                {forecastHorizon === "now" ? "live conditions" : `forecast ${forecastHorizon}`}.
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm text-zinc-800">
            <div>• {reportSummary.freshness}</div>
            <div>• {reportSummary.rain}</div>
            <div>• {reportSummary.depth}</div>
            <div>• {reportSummary.activation}</div>
            <div>• {reportSummary.waterStatus}</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-base font-extrabold text-zinc-900">Raw Records</div>
              <div className="mt-1 text-xs text-zinc-500">
                {selectedSensor.name} • newest first • when enabled, shows last 120 rows
              </div>
            </div>

            <button
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-zinc-50"
              onClick={() => setShowLogs((v) => !v)}
              type="button"
            >
              {showLogs ? "Hide logs" : "Show logs"}
            </button>
          </div>

          {!showLogs ? (
            <div className="mt-4 text-sm text-zinc-600">
              Logs hidden for performance. Click <span className="font-semibold">Show logs</span>{" "}
              when needed.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1200px] w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-gray-900">
                    {[
                      "Time",
                      "Stale",
                      "Tips60",
                      "Rain60(mm)",
                      "Rate60",
                      "Tips300",
                      "Rain300(mm)",
                      "Rate300",
                      "FloodDepth(cm)",
                      "rawDist(cm)",
                      "usValid",
                      "accepted",
                      "overflow",
                      "RSSI",
                      "Activated",
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 font-semibold"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {[...recent]
                    .slice(-120)
                    .reverse()
                    .map((p, idx) => {
                      const rowActivated =
                        !p.isStale &&
                        ((p.tips60 ?? 0) > 0 || (p.floodDepthCm ?? 0) >= DEPTH_ON_CM);

                      return (
                        <tr
                          key={`${p.tsMs ?? "no-ts"}-${idx}`}
                          className="border-b border-zinc-100 text-gray-900"
                        >
                          <td className="whitespace-nowrap px-3 py-3">{fmtTime(p.tsMs)}</td>
                          <td className="px-3 py-3">{p.isStale ? "YES" : "NO"}</td>

                          <td className="px-3 py-3">{fmtInt(p.tips60)}</td>
                          <td className="px-3 py-3">
                            {p.rainMm60 != null ? fmt(p.rainMm60, 2) : "—"}
                          </td>
                          <td className="px-3 py-3">
                            {p.rainRateMmHr60 != null ? fmt(p.rainRateMmHr60, 1) : "—"}
                          </td>

                          <td className="px-3 py-3">{fmtInt(p.tips300)}</td>
                          <td className="px-3 py-3">
                            {p.rainMm300 != null ? fmt(p.rainMm300, 2) : "—"}
                          </td>
                          <td className="px-3 py-3">
                            {p.rainRateMmHr300 != null ? fmt(p.rainRateMmHr300, 1) : "—"}
                          </td>

                          <td className="px-3 py-3">
                            {p.floodDepthCm != null ? fmt(p.floodDepthCm, 1) : "—"}
                          </td>
                          <td className="px-3 py-3">
                            {p.rawDistCm != null ? fmt(p.rawDistCm, 1) : "—"}
                          </td>

                          <td className="px-3 py-3">
                            {p.usValid == null ? "—" : p.usValid ? "true" : "false"}
                          </td>
                          <td className="px-3 py-3">
                            {p.acceptedForStable == null
                              ? "—"
                              : p.acceptedForStable
                              ? "true"
                              : "false"}
                          </td>
                          <td className="px-3 py-3">
                            {p.overflow == null ? "—" : p.overflow ? "true" : "false"}
                          </td>

                          <td className="px-3 py-3">
                            {p.rssiDbm != null ? fmtInt(p.rssiDbm) : "—"}
                          </td>
                          <td className="px-3 py-3">{rowActivated ? "ON" : "OFF"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}