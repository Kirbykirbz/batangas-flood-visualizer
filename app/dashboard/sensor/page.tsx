"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clamp01,
  computeFloodRisk,
  getStageLabel,
  type ForecastHorizon,
} from "@/app/lib/floodForecast";
import {
  extractBatteryPercentage,
  extractFloodDepthCm,
  extractRainMmHr,
  extractRssiDbm,
  extractTimestampMs,
  isOverflow,
} from "@/app/lib/sensorReading";
import { listSensors, type SensorRecord } from "@/app/lib/sensorsRepo";
import type { SensorPoint } from "@/app/lib/sensorStore";

type Payload = {
  latest: SensorPoint | null;
  recent: SensorPoint[];
  latestByDevice?: Record<string, SensorPoint>;
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
  batteryPercentage: number | null;
  networkType: string | null;
  rainMm60: number | null;
  rainMm300: number | null;
  hasTs: boolean;
  isStale: boolean;
};

function classifyFloodCm(depthCm: number, overflow = false): FloodStatus {
  if (overflow || depthCm >= 30) {
    return { label: "DANGER", note: "High flood depth or overflow detected" };
  }
  if (depthCm >= 20) {
    return { label: "WARNING", note: "Rising flood depth (≥ 20 cm)" };
  }
  if (depthCm >= 10) {
    return { label: "WATCH", note: "Flood watch level (≥ 10 cm)" };
  }
  return { label: "NORMAL", note: "Normal flood depth" };
}

function classifyRainMmHr(mmHr: number): RainStatus {
  const x = Math.max(0, mmHr);

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

function riskToneClasses(risk: number) {
  if (risk <= 0.3) return "text-emerald-700";
  if (risk <= 0.6) return "text-amber-700";
  return "text-red-700";
}

function normalizePoint(p: SensorPoint | null, nowMs: number): NormalizedPoint | null {
  if (!p) return null;

  const tsMs = extractTimestampMs(p);
  const STALE_MS = 15_000;
  const hasTs = tsMs != null;
  const isStale = hasTs ? nowMs - tsMs > STALE_MS : true;

  const rainRateMmHr60 = toNumber(p.rainRateMmHr60);
  const rainRateMmHr300 = toNumber(p.rainRateMmHr300);
  const tips60 = toNumber(p.tips60);
  const tips300 = toNumber(p.tips300);

  return {
    tsMs,
    deviceId: p.deviceId ?? null,
    rawDistCm: toNumber(p.rawDistCm),
    rawWaterCm: toNumber(p.rawWaterCm),
    stableWaterCm: toNumber(p.stableWaterCm),
    usValid: p.usValid ?? null,
    acceptedForStable: p.acceptedForStable ?? null,
    overflow: p.overflow ?? null,
    rainTicksTotal: toNumber(p.rainTicksTotal),
    tips60,
    tips300,
    rainRateMmHr60,
    rainRateMmHr300,
    rssiDbm: toNumber(p.rssiDbm),
    dryDistanceCm: toNumber(p.dryDistanceCm),
    floodDepthCm: extractFloodDepthCm(p),
    batteryPercentage: toNumber(p.batteryPercentage),
    networkType: typeof p.networkType === "string" ? p.networkType : null,
    rainMm60: tips60 != null ? tips60 * 0.327 : null,
    rainMm300: tips300 != null ? tips300 * 0.327 : null,
    hasTs,
    isStale,
  };
}

export default function SensorDashboardPage() {
  const [sensorRecords, setSensorRecords] = useState<SensorRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>("now");

  const [latestByDevice, setLatestByDevice] = useState<Record<string, SensorPoint>>({});
  const [recentRaw, setRecentRaw] = useState<SensorPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sensorLoading, setSensorLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [weatherError, setWeatherError] = useState<string>("");

  const [lastFetchAt, setLastFetchAt] = useState<number>(0);
  const [showLogs, setShowLogs] = useState(false);

  const [rainMemory, setRainMemory] = useState(0);
  const lastRainUpdateRef = useRef<number | null>(null);

  const inFlightLatestRef = useRef(false);
  const inFlightLogsRef = useRef(false);

  const POLL_LATEST_MS = 1000;
  const POLL_LOGS_MS = 5000;
  const WX_POLL_MS = 60_000;

  const DEPTH_ON_CM = 5;
  const RAIN_FULL_MMHR = 50;
  const DEPTH_FULL_CM = 30;
  const TAU_MIN = 60;
  const DEPTH_DAMP_BASE = 0.2;

  useEffect(() => {
    let cancelled = false;

    async function loadSensorsFromDb() {
      try {
        setSensorLoading(true);
        const rows = await listSensors();
        if (!cancelled) {
          const activeRows = rows.filter((s) => s.is_active);
          setSensorRecords(activeRows);

          setSelectedDeviceId((prev) => {
            if (prev && activeRows.some((s) => s.id === prev)) return prev;
            return activeRows[0]?.id ?? "";
          });
        }
      } catch (err) {
        console.error("Failed to load sensors:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sensors.");
        }
      } finally {
        if (!cancelled) setSensorLoading(false);
      }
    }

    loadSensorsFromDb();
    return () => {
      cancelled = true;
    };
  }, []);

  const sensors = useMemo(() => {
    return sensorRecords.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      zoneLabel: s.zone_label ?? "—",
      dryDistanceCm: s.dry_distance_cm ?? null,
    }));
  }, [sensorRecords]);

  const selectedSensor = useMemo(
    () => sensors.find((s) => s.id === selectedDeviceId) ?? sensors[0] ?? null,
    [sensors, selectedDeviceId]
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
    if (!selectedDeviceId) return;
    const url = `/api/report/export?deviceId=${encodeURIComponent(
      selectedDeviceId
    )}&format=csv&limit=5000`;
    downloadFile(url);
  }

  function handleDownloadJson() {
    if (!selectedDeviceId) return;
    const url = `/api/report/export?deviceId=${encodeURIComponent(
      selectedDeviceId
    )}&format=json&limit=5000`;
    downloadFile(url);
  }

  async function loadLatestOnly() {
    if (!selectedDeviceId || inFlightLatestRef.current) return;
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

      setLatestByDevice(json.latestByDevice ?? {});
      setRecentRaw(Array.isArray(json.recent) ? json.recent : []);
      setError("");
      setLastFetchAt(json.serverTime ?? Date.now());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
      inFlightLatestRef.current = false;
    }
  }

  async function loadLogs() {
    if (!selectedDeviceId || inFlightLogsRef.current) return;
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
    if (!selectedDeviceId) return;

    loadLatestOnly();
    const id = window.setInterval(loadLatestOnly, POLL_LATEST_MS);
    return () => clearInterval(id);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!showLogs || !selectedDeviceId) return;

    loadLogs();
    const id = window.setInterval(loadLogs, POLL_LOGS_MS);
    return () => clearInterval(id);
  }, [showLogs, selectedDeviceId]);

  async function loadWeather() {
    if (!selectedSensor) return;

    try {
      const res = await fetch(
        `/api/weather?lat=${selectedSensor.lat}&lng=${selectedSensor.lng}&t=${Date.now()}`,
        { cache: "no-store" }
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
    if (!selectedSensor) return;
    loadWeather();
    const id = setInterval(loadWeather, WX_POLL_MS);
    return () => clearInterval(id);
  }, [selectedSensor?.id]);

  const nowMs = lastFetchAt || Date.now();

  const selectedLatestRaw = useMemo(
    () => (selectedDeviceId ? latestByDevice[selectedDeviceId] ?? null : null),
    [latestByDevice, selectedDeviceId]
  );

  const latest = useMemo(() => {
    return normalizePoint(selectedLatestRaw, nowMs);
  }, [selectedLatestRaw, nowMs]);

  const recent = useMemo(() => {
    if (!showLogs || !selectedDeviceId) return [] as NormalizedPoint[];

    const filtered = recentRaw.filter((p) => p.deviceId === selectedDeviceId);
    return filtered
      .map((p) => normalizePoint(p, nowMs))
      .filter((p): p is NormalizedPoint => p != null);
  }, [recentRaw, selectedDeviceId, showLogs, nowMs]);

  const floodDepthCmCurrent = useMemo(() => extractFloodDepthCm(selectedLatestRaw), [selectedLatestRaw]);
  const rainMmHrCurrent = useMemo(() => extractRainMmHr(selectedLatestRaw), [selectedLatestRaw]);
  const latestOverflow = useMemo(() => isOverflow(selectedLatestRaw), [selectedLatestRaw]);

  useEffect(() => {
    const now = Date.now();
    const last = lastRainUpdateRef.current;
    lastRainUpdateRef.current = now;

    const rainFactorCurrent = clamp01(rainMmHrCurrent / RAIN_FULL_MMHR);

    const rafId = window.requestAnimationFrame(() => {
      setRainMemory((prev) => {
        if (last == null) {
          return rainFactorCurrent;
        }

        const dtMin = (now - last) / 60000;
        const decay = Math.exp(-dtMin / TAU_MIN);

        return Math.max(rainFactorCurrent, prev * decay);
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [rainMmHrCurrent]);

  // EXACT SAME CORE COMPUTATION PATH AS MAP:
  const currentRisk = useMemo(() => {
    return computeFloodRisk({
      forecastHorizon: "now",
      rainMmHrCurrent,
      floodDepthCmCurrent,
      rainMemory,
      rainFullMmHr: RAIN_FULL_MMHR,
      depthFullCm: DEPTH_FULL_CM,
      depthOnCm: DEPTH_ON_CM,
      depthDampBase: DEPTH_DAMP_BASE,
      overflow: latestOverflow,
    });
  }, [
    rainMmHrCurrent,
    floodDepthCmCurrent,
    rainMemory,
    latestOverflow,
  ]);

  const scenarioRisk = useMemo(() => {
    return computeFloodRisk({
      forecastHorizon,
      rainMmHrCurrent,
      floodDepthCmCurrent,
      rainMemory,
      rainFullMmHr: RAIN_FULL_MMHR,
      depthFullCm: DEPTH_FULL_CM,
      depthOnCm: DEPTH_ON_CM,
      depthDampBase: DEPTH_DAMP_BASE,
      overflow: latestOverflow,
    });
  }, [
    forecastHorizon,
    rainMmHrCurrent,
    floodDepthCmCurrent,
    rainMemory,
    latestOverflow,
  ]);

  const flood = useMemo(() => {
    return classifyFloodCm(scenarioRisk.scenario.floodDepthCm, latestOverflow);
  }, [scenarioRisk.scenario.floodDepthCm, latestOverflow]);

  const rainStatus = useMemo(() => {
    return classifyRainMmHr(rainMmHrCurrent);
  }, [rainMmHrCurrent]);

  const forecastDeltaDepth = useMemo(() => {
    return scenarioRisk.scenario.floodDepthCm - currentRisk.scenario.floodDepthCm;
  }, [scenarioRisk.scenario.floodDepthCm, currentRisk.scenario.floodDepthCm]);

  const forecastDeltaRisk = useMemo(() => {
    return scenarioRisk.dynamicRisk - currentRisk.dynamicRisk;
  }, [scenarioRisk.dynamicRisk, currentRisk.dynamicRisk]);

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
    const depthOn = scenarioRisk.scenario.floodDepthCm >= DEPTH_ON_CM;
    const overflowOn = latestOverflow;

    if (overflowOn) {
      return { on: true, reason: "Overflow detected" };
    }
    if (tipsOn && depthOn) {
      return { on: true, reason: "Raining now (tips60 > 0) + depth above threshold" };
    }
    if (tipsOn) {
      return { on: true, reason: "Raining now (tips60 > 0)" };
    }
    if (depthOn) {
      return {
        on: true,
        reason: `Flood depth ≥ ${DEPTH_ON_CM} cm (current or forecast)`,
      };
    }

    return { on: false, reason: "No rain tips and flood depth below threshold" };
  }, [latest, scenarioRisk.scenario.floodDepthCm, latestOverflow]);

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

    if (latest.batteryPercentage != null) {
      pills.push({
        text: `Battery ${fmtInt(latest.batteryPercentage)}%`,
        tone: latest.batteryPercentage < 20 ? "warn" : "neutral",
      });
    }

    return pills;
  }, [latest, activation.on]);

  const reportSummary = useMemo(() => {
    const tips60 = latest?.tips60 ?? null;
    const tips300 = latest?.tips300 ?? null;
    const rainMm300 = latest?.rainMm300 ?? null;
    const currentDepth = currentRisk.scenario.floodDepthCm ?? null;
    const scenarioDepth = scenarioRisk.scenario.floodDepthCm ?? null;
    const dryDist = latest?.dryDistanceCm ?? selectedSensor?.dryDistanceCm ?? null;
    const rawDist = latest?.rawDistCm ?? null;
    const fresh = latest ? !latest.isStale : false;

    return {
      freshness: fresh ? "Live telemetry received." : "Telemetry stale/offline (no recent update).",
      rain: `Current rain intensity: ${rainStatus.label} (${fmt(
        rainStatus.mmHr,
        1
      )} mm/hr). Tips60=${tips60 ?? "—"}, Tips300=${tips300 ?? "—"}, Rain300=${
        rainMm300 != null ? fmt(rainMm300, 2) : "—"
      } mm.`,
      depth: `Current depth: ${currentDepth != null ? fmt(currentDepth, 1) : "—"} cm. Scenario depth: ${
        scenarioDepth != null ? fmt(scenarioDepth, 1) : "—"
      } cm. Dry distance=${dryDist != null ? fmt(dryDist, 1) : "—"} cm, Raw distance=${
        rawDist != null ? fmt(rawDist, 1) : "—"
      } cm.`,
      activation: `Map activation: ${activation.on ? "ON" : "OFF"} — ${activation.reason}.`,
      waterStatus: `Water-level status: ${flood.label} — ${flood.note}.`,
      risk: `Current risk: ${currentRisk.dynamicRisk.toFixed(3)} • Scenario risk: ${scenarioRisk.dynamicRisk.toFixed(
        3
      )} • Scenario stage: ${getStageLabel(scenarioRisk.riskStage)}.`,
    };
  }, [latest, activation, rainStatus, flood, currentRisk, scenarioRisk, selectedSensor]);

  if (sensorLoading || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-zinc-500">Loading sensor dashboard…</div>
        </div>
      </div>
    );
  }

  if (error && sensors.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
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

  if (!selectedSensor) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-base font-extrabold text-zinc-900">No Active Sensors</div>
          <div className="mt-2 text-sm text-zinc-700">
            No active sensors were found in the database.
          </div>
          <div className="mt-4">
            <Link
              href="/dashboard/admin/sensors"
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-zinc-50"
            >
              Open Admin Sensors
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const stableCm = latest?.stableWaterCm ?? null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
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
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name} — {sensor.zoneLabel}
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
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Flood Monitoring
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                Sensor Dashboard — {selectedSensor.name}
              </h1>
              <div className="mt-2 text-sm text-zinc-600">
                <span className="font-semibold">Mode:</span>{" "}
                {forecastHorizon === "now" ? "Live / Current" : `Forecast +${forecastHorizon}`}
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                <span className="font-semibold">Latest:</span> {fmtTime(latest?.tsMs ?? null)}
                {secondsSinceFetch != null ? (
                  <span className="text-zinc-500"> • Refreshed {secondsSinceFetch}s ago</span>
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
                  rainStatus.label
                )}`}
              >
                RAIN {rainStatus.label}
                <span className="ml-2 font-semibold opacity-90">• {rainStatus.note}</span>
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
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-extrabold text-zinc-900">Weather (Open-Meteo)</div>
              <div className="mt-1 text-xs text-zinc-500">
                {selectedSensor.name} • Location: {selectedSensor.lat.toFixed(5)}, {selectedSensor.lng.toFixed(5)} •
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

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-base font-extrabold text-zinc-900">Current vs forecast scenario</div>
                <div className="mt-1 text-sm text-zinc-600">
                  Forecast uses the same persistence-aware risk engine as the live flood map.
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Scenario mode</div>
                <div className="mt-1 text-lg font-extrabold text-zinc-900">
                  {forecastHorizon === "now" ? "Live / Current" : `Forecast +${forecastHorizon}`}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Rain memory: {rainMemory.toFixed(3)}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">5-minute rain rate</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {latest?.rainRateMmHr300 != null ? `${fmt(latest.rainRateMmHr300, 1)} mm/hr` : "—"}
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  Live measured intensity. This is not projected upward by horizon.
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Projected rain total</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {forecastHorizon === "now"
                    ? "—"
                    : `${fmt(scenarioRisk.scenario.projectedRainMm, 1)} mm`}
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  Scenario accumulation if current intensity persists.
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Stable water level</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {stableCm != null ? `${fmt(stableCm / 30.48, 2)} ft` : "—"}
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  {stableCm != null ? `${fmt(stableCm, 1)} cm (filtered)` : "—"}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Current flood depth</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {fmt(currentRisk.scenario.floodDepthCm, 1)} cm
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  RawDist: {latest?.rawDistCm != null ? `${fmt(latest.rawDistCm, 1)} cm` : "—"} •
                  DryDist:{" "}
                  {latest?.dryDistanceCm != null
                    ? `${fmt(latest.dryDistanceCm, 1)} cm`
                    : selectedSensor.dryDistanceCm != null
                    ? `${fmt(selectedSensor.dryDistanceCm, 1)} cm`
                    : "—"}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Scenario flood depth</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {fmt(scenarioRisk.scenario.floodDepthCm, 1)} cm
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  Δ depth:{" "}
                  <span className={forecastDeltaDepth > 0 ? "font-bold text-red-700" : "font-bold text-zinc-700"}>
                    {forecastHorizon === "now" ? "—" : `${forecastDeltaDepth >= 0 ? "+" : ""}${fmt(forecastDeltaDepth, 1)} cm`}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Map activation</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
                  {activation.on ? "ON" : "OFF"}
                </div>
                <div className="mt-2 text-sm text-zinc-500">{activation.reason}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-base font-extrabold text-zinc-900">Risk engine</div>
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Current risk</div>
                <div className={`mt-2 text-3xl font-extrabold tracking-tight ${riskToneClasses(currentRisk.dynamicRisk)}`}>
                  {currentRisk.dynamicRisk.toFixed(3)}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  Stage: {getStageLabel(currentRisk.riskStage)}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Scenario risk</div>
                <div className={`mt-2 text-3xl font-extrabold tracking-tight ${riskToneClasses(scenarioRisk.dynamicRisk)}`}>
                  {scenarioRisk.dynamicRisk.toFixed(3)}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  Stage: {getStageLabel(scenarioRisk.riskStage)}
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  Δ risk:{" "}
                  <span className={forecastDeltaRisk > 0 ? "font-bold text-red-700" : "font-bold text-zinc-700"}>
                    {forecastHorizon === "now" ? "—" : `${forecastDeltaRisk >= 0 ? "+" : ""}${forecastDeltaRisk.toFixed(3)}`}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Computation details</div>
                <div className="mt-2 space-y-1 text-xs text-zinc-700">
                  <div>
                    Current rain factor: <span className="font-bold">{currentRisk.rainFactor.toFixed(3)}</span>
                  </div>
                  <div>
                    Current depth factor: <span className="font-bold">{currentRisk.depthFactor.toFixed(3)}</span>
                  </div>
                  <div>
                    Current effective depth: <span className="font-bold">{currentRisk.effectiveDepthFactor.toFixed(3)}</span>
                  </div>
                  <div className="pt-2">
                    Scenario rain factor: <span className="font-bold">{scenarioRisk.rainFactor.toFixed(3)}</span>
                  </div>
                  <div>
                    Scenario depth factor: <span className="font-bold">{scenarioRisk.depthFactor.toFixed(3)}</span>
                  </div>
                  <div>
                    Scenario effective depth: <span className="font-bold">{scenarioRisk.effectiveDepthFactor.toFixed(3)}</span>
                  </div>
                </div>
              </div>
            </div>
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
                  <span className="font-semibold">flood depth ≥ {DEPTH_ON_CM} cm</span>.
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 sm:min-w-[320px]">
                <div className="text-xs font-semibold text-zinc-500">Status snapshot</div>
                <div className="mt-2 space-y-2 text-xs text-zinc-700">
                  <div>
                    Flood status: <span className="font-bold">{flood.label}</span>
                  </div>
                  <div>
                    Rain status: <span className="font-bold">{rainStatus.label}</span>
                  </div>
                  <div>
                    Overflow: <span className="font-bold">{latestOverflow ? "Yes" : "No"}</span>
                  </div>
                  <div>
                    Latest timestamp: <span className="font-bold">{fmtTime(latest?.tsMs ?? null)}</span>
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

              <dt className="text-zinc-500">Rate (60s)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainRateMmHr60 != null ? `${fmt(latest.rainRateMmHr60, 1)} mm/hr` : "—"}
              </dd>

              <dt className="text-zinc-500">Tips (5m)</dt>
              <dd className="text-right font-bold text-zinc-900">{fmtInt(latest?.tips300 ?? null)}</dd>

              <dt className="text-zinc-500">Rain (5m)</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.rainMm300 != null ? `${fmt(latest.rainMm300, 2)} mm` : "—"}
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

              <dt className="text-zinc-500">Battery</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.batteryPercentage != null ? `${fmtInt(latest.batteryPercentage)}%` : "—"}
              </dd>

              <dt className="text-zinc-500">Network</dt>
              <dd className="text-right font-bold text-zinc-900">
                {latest?.networkType ?? "—"}
              </dd>
            </dl>

            <div className="mt-3 text-xs text-zinc-500">
              Calibration: 0.327 mm/tip (tipping bucket). Forecast uses projected rainfall total, not a fake projected 5-minute intensity.
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
            <div>• {reportSummary.risk}</div>
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
              <table className="min-w-[1300px] w-full border-collapse text-left text-xs">
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
                      "Battery",
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
                    .filter((p) => p.deviceId === selectedDeviceId)
                    .slice(-120)
                    .reverse()
                    .map((p, idx) => {
                      const rowActivated =
                        !p.isStale &&
                        (Boolean(p.overflow) ||
                          (p.tips60 ?? 0) > 0 ||
                          (p.floodDepthCm ?? 0) >= DEPTH_ON_CM);

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
                            {p.batteryPercentage != null ? `${fmtInt(p.batteryPercentage)}%` : "—"}
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