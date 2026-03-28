"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  toNumber,
} from "@/app/lib/sensorReading";
import { listSensors, type SensorRecord } from "@/app/lib/sensorsRepo";
import type { SensorPoint } from "@/app/lib/sensorStore";

type Payload = {
  latest: SensorPoint | null;
  recent: SensorPoint[];
  latestByDevice?: Record<string, SensorPoint>;
  serverTime: number;
  source?: "supabase" | "memory";
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

const STALE_MS = 15_000;
const POLL_SUMMARY_MS = 2_000;
const POLL_LOGS_MS = 7_000;
const WX_POLL_MS = 60_000;

const DEPTH_ON_CM = 5;
const RAIN_FULL_MMHR = 50;
const DEPTH_FULL_CM = 30;
const TAU_MIN = 60;
const DEPTH_DAMP_BASE = 0.2;
const MM_PER_TIP = 0.27;

const LOG_LIMIT_OPTIONS = [20, 50, 100, 200, 500];
const MANILA_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

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
  return MANILA_FORMATTER.format(d);
}

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

function normalizePoint(p: SensorPoint | null, nowMs: number): NormalizedPoint | null {
  if (!p) return null;

  const tsMs = extractTimestampMs(p);
  const hasTs = tsMs != null;
  const isStale = hasTs ? nowMs - tsMs > STALE_MS : true;

  const tips60 = toNumber(p.tips60);
  const tips300 = toNumber(p.tips300);

  return {
    tsMs,
    deviceId: p.deviceId ?? null,
    rawDistCm: toNumber(p.rawDistCm),
    rawWaterCm: toNumber(p.rawWaterCm),
    stableWaterCm: toNumber(p.stableWaterCm),
    usValid: typeof p.usValid === "boolean" ? p.usValid : null,
    acceptedForStable:
      typeof p.acceptedForStable === "boolean" ? p.acceptedForStable : null,
    overflow: typeof p.overflow === "boolean" ? p.overflow : null,
    rainTicksTotal: toNumber(p.rainTicksTotal),
    tips60,
    tips300,
    rainRateMmHr60: toNumber(p.rainRateMmHr60),
    rainRateMmHr300: toNumber(p.rainRateMmHr300),
    rssiDbm: extractRssiDbm(p),
    dryDistanceCm: toNumber(p.dryDistanceCm),
    floodDepthCm: toNumber(p.floodDepthCm),
    batteryPercentage: extractBatteryPercentage(p),
    networkType: typeof p.networkType === "string" ? p.networkType : null,
    rainMm60: tips60 != null ? tips60 * MM_PER_TIP : null,
    rainMm300: tips300 != null ? tips300 * MM_PER_TIP : null,
    hasTs,
    isStale,
  };
}

function badgeToneClasses(tone: "ok" | "warn" | "bad" | "neutral") {
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

function floodBadgeClasses(label: FloodStatus["label"]) {
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

function riskToneClasses(risk: number) {
  if (risk <= 0.3) return "text-emerald-700";
  if (risk <= 0.6) return "text-amber-700";
  return "text-red-700";
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="text-base font-extrabold text-zinc-900">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-zinc-500">{subtitle}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : tone === "bad"
      ? "text-red-700"
      : "text-zinc-900";

  return (
    <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-extrabold tracking-tight ${toneClass}`}>
        {value}
      </div>
      {detail ? <div className="mt-2 text-xs text-zinc-500">{detail}</div> : null}
    </div>
  );
}

export default function SensorDashboardPage() {
  const [sensorRecords, setSensorRecords] = useState<SensorRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [logsDeviceId, setLogsDeviceId] = useState("");
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>("now");
  const [logsLimit, setLogsLimit] = useState(100);

  const [latestByDevice, setLatestByDevice] = useState<Record<string, SensorPoint>>({});
  const [recentRaw, setRecentRaw] = useState<SensorPoint[]>([]);

  const [sensorLoading, setSensorLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  const [lastFetchAt, setLastFetchAt] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const [rainMemory, setRainMemory] = useState(0);
  const [showLogs, setShowLogs] = useState(false);

  const lastRainUpdateRef = useRef<number | null>(null);
  const inFlightSummaryRef = useRef(false);
  const inFlightLogsRef = useRef(false);
  const inFlightWeatherRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    setClockMs(Date.now());
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSensorsFromDb() {
      try {
        setSensorLoading(true);
        const rows = await listSensors();
        if (cancelled) return;

        const activeRows = rows.filter((s) => s.is_active);
        setSensorRecords(activeRows);

        const firstId = activeRows[0]?.id ?? "";

        setSelectedDeviceId((prev) => {
          if (prev && activeRows.some((s) => s.id === prev)) return prev;
          return firstId;
        });

        setLogsDeviceId((prev) => {
          if (prev && activeRows.some((s) => s.id === prev)) return prev;
          return firstId;
        });
      } catch (err) {
        if (!cancelled) {
          setSummaryError(
            err instanceof Error ? err.message : "Failed to load sensors."
          );
        }
      } finally {
        if (!cancelled) setSensorLoading(false);
      }
    }

    void loadSensorsFromDb();
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

  const selectedLogsSensor = useMemo(
    () => sensors.find((s) => s.id === logsDeviceId) ?? sensors[0] ?? null,
    [sensors, logsDeviceId]
  );

  const nowMs = lastFetchAt || clockMs || Date.now();

  const loadSummary = useCallback(async () => {
    if (!selectedDeviceId || inFlightSummaryRef.current) return;
    inFlightSummaryRef.current = true;

    try {
      const res = await fetch(
        `/api/data?deviceId=${encodeURIComponent(
          selectedDeviceId
        )}&limit=1&includeRecent=false&includeLatestByDevice=true&t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json: Payload = await res.json();
      setLatestByDevice(json.latestByDevice ?? {});
      setSummaryError("");
      setLastFetchAt(json.serverTime ?? Date.now());
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Failed to load latest data."
      );
    } finally {
      setSummaryLoading(false);
      inFlightSummaryRef.current = false;
    }
  }, [selectedDeviceId]);

  const loadLogs = useCallback(async () => {
    if (!logsDeviceId || inFlightLogsRef.current) return;
    inFlightLogsRef.current = true;

    try {
      setLogsLoading(true);
      const res = await fetch(
        `/api/data?deviceId=${encodeURIComponent(
          logsDeviceId
        )}&limit=${logsLimit}&includeRecent=true&includeLatestByDevice=false&t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json: Payload = await res.json();
      setRecentRaw(Array.isArray(json.recent) ? json.recent : []);
      setLastFetchAt((prev) => json.serverTime ?? prev);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLogsLoading(false);
      inFlightLogsRef.current = false;
    }
  }, [logsDeviceId, logsLimit]);

  const loadWeather = useCallback(async () => {
    if (!selectedSensor || inFlightWeatherRef.current) return;
    inFlightWeatherRef.current = true;

    try {
      setWeatherLoading(true);
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
    } catch (err) {
      setWeather(null);
      setWeatherError(
        err instanceof Error ? err.message : "Failed to load weather."
      );
    } finally {
      setWeatherLoading(false);
      inFlightWeatherRef.current = false;
    }
  }, [selectedSensor]);

  useEffect(() => {
    if (!selectedDeviceId) return;

    void loadSummary();
    const id = window.setInterval(() => {
      void loadSummary();
    }, POLL_SUMMARY_MS);

    return () => window.clearInterval(id);
  }, [selectedDeviceId, loadSummary]);

  useEffect(() => {
    if (!showLogs || !logsDeviceId) return;

    void loadLogs();
    const id = window.setInterval(() => {
      void loadLogs();
    }, POLL_LOGS_MS);

    return () => window.clearInterval(id);
  }, [showLogs, logsDeviceId, logsLimit, loadLogs]);

  useEffect(() => {
    if (!selectedSensor) return;

    void loadWeather();
    const id = window.setInterval(() => {
      void loadWeather();
    }, WX_POLL_MS);

    return () => window.clearInterval(id);
  }, [selectedSensor, loadWeather]);

  useEffect(() => {
    const now = Date.now();
    const last = lastRainUpdateRef.current;
    lastRainUpdateRef.current = now;

    const selectedLatestRaw =
      selectedDeviceId && latestByDevice[selectedDeviceId]
        ? latestByDevice[selectedDeviceId]
        : null;
    const rainMmHrCurrent = extractRainMmHr(selectedLatestRaw);
    const rainFactorCurrent = clamp01(rainMmHrCurrent / RAIN_FULL_MMHR);

    const rafId = window.requestAnimationFrame(() => {
      setRainMemory((prev) => {
        if (last == null) return rainFactorCurrent;
        const dtMin = (now - last) / 60000;
        const decay = Math.exp(-dtMin / TAU_MIN);
        return Math.max(rainFactorCurrent, prev * decay);
      });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [selectedDeviceId, latestByDevice]);

  const selectedLatestRaw = useMemo(
    () => (selectedDeviceId ? latestByDevice[selectedDeviceId] ?? null : null),
    [selectedDeviceId, latestByDevice]
  );

  const latest = useMemo(
    () => normalizePoint(selectedLatestRaw, nowMs),
    [selectedLatestRaw, nowMs]
  );

  const recent = useMemo(() => {
    return recentRaw
      .map((p) => normalizePoint(p, nowMs))
      .filter((p): p is NormalizedPoint => p != null)
      .sort((a, b) => (b.tsMs ?? 0) - (a.tsMs ?? 0));
  }, [recentRaw, nowMs]);

  const floodDepthCmCurrent = useMemo(
    () => extractFloodDepthCm(selectedLatestRaw),
    [selectedLatestRaw]
  );
  const rainMmHrCurrent = useMemo(
    () => extractRainMmHr(selectedLatestRaw),
    [selectedLatestRaw]
  );
  const latestOverflow = useMemo(
    () => isOverflow(selectedLatestRaw),
    [selectedLatestRaw]
  );

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
  }, [rainMmHrCurrent, floodDepthCmCurrent, rainMemory, latestOverflow]);

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

  const flood = useMemo(
    () => classifyFloodCm(scenarioRisk.scenario.floodDepthCm, latestOverflow),
    [scenarioRisk.scenario.floodDepthCm, latestOverflow]
  );

  const rainStatus = useMemo(
    () => classifyRainMmHr(rainMmHrCurrent),
    [rainMmHrCurrent]
  );

  const dataQuality = useMemo(() => {
    if (!latest) {
      return { label: "NO DATA", tone: "bad" as const, note: "No latest reading" };
    }
    if (!latest.hasTs) {
      return { label: "NO TS", tone: "bad" as const, note: "Missing timestamp" };
    }
    if (latest.isStale) {
      return { label: "STALE", tone: "warn" as const, note: "No update in 15s" };
    }
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

    if (overflowOn) return { on: true, reason: "Overflow detected" };
    if (tipsOn && depthOn) {
      return { on: true, reason: "Raining now (tips60 > 0) + depth above threshold" };
    }
    if (tipsOn) return { on: true, reason: "Raining now (tips60 > 0)" };
    if (depthOn) {
      return {
        on: true,
        reason: `Flood depth ≥ ${DEPTH_ON_CM} cm (current or forecast)`,
      };
    }

    return { on: false, reason: "No rain tips and flood depth below threshold" };
  }, [latest, scenarioRisk.scenario.floodDepthCm, latestOverflow]);

  const forecastDeltaDepth = useMemo(
    () => scenarioRisk.scenario.floodDepthCm - currentRisk.scenario.floodDepthCm,
    [scenarioRisk.scenario.floodDepthCm, currentRisk.scenario.floodDepthCm]
  );

  const forecastDeltaRisk = useMemo(
    () => scenarioRisk.dynamicRisk - currentRisk.dynamicRisk,
    [scenarioRisk.dynamicRisk, currentRisk.dynamicRisk]
  );

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
      freshness: fresh
        ? "Live telemetry received."
        : "Telemetry stale/offline (no recent update).",
      rain: `Current rain intensity: ${rainStatus.label} (${fmt(
        rainStatus.mmHr,
        1
      )} mm/hr). Tips60=${tips60 ?? "—"}, Tips300=${tips300 ?? "—"}, Rain300=${
        rainMm300 != null ? fmt(rainMm300, 2) : "—"
      } mm.`,
      depth: `Current depth: ${
        currentDepth != null ? fmt(currentDepth, 1) : "—"
      } cm. Scenario depth: ${
        scenarioDepth != null ? fmt(scenarioDepth, 1) : "—"
      } cm. Dry distance=${dryDist != null ? fmt(dryDist, 1) : "—"} cm, Raw distance=${
        rawDist != null ? fmt(rawDist, 1) : "—"
      } cm.`,
      activation: `Map activation: ${activation.on ? "ON" : "OFF"} — ${activation.reason}.`,
      waterStatus: `Water-level status: ${flood.label} — ${flood.note}.`,
      risk: `Current risk: ${currentRisk.dynamicRisk.toFixed(
        3
      )} • Scenario risk: ${scenarioRisk.dynamicRisk.toFixed(
        3
      )} • Scenario stage: ${getStageLabel(scenarioRisk.riskStage)}.`,
    };
  }, [latest, activation, rainStatus, flood, currentRisk, scenarioRisk, selectedSensor]);

  if (sensorLoading || summaryLoading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm text-zinc-500">Loading sensor dashboard…</div>
          </div>
        </div>
      </div>
    );
  }

  if (summaryError && sensors.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-base font-extrabold text-zinc-900">Error</div>
            <div className="mt-2 text-sm text-zinc-700">{summaryError}</div>
            <button
              type="button"
              onClick={() => void loadSummary()}
              className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedSensor) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-base font-extrabold text-zinc-900">No Active Sensors</div>
            <div className="mt-2 text-sm text-zinc-700">
              No active sensors were found in the database.
            </div>
            <div className="mt-4">
              <Link
                href="/dashboard/admin/sensors"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                Open Admin Sensors
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stableCm = latest?.stableWaterCm ?? null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={() => void loadSummary()}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-zinc-700">
              <span>Sensor</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedDeviceId(nextId);
                  setLogsDeviceId(nextId);
                }}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
              >
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name} — {sensor.zoneLabel}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-zinc-700">
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

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Flood Monitoring
              </div>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
                {selectedSensor.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                <span>Zone: {selectedSensor.zoneLabel}</span>
                <span>•</span>
                <span>{forecastHorizon === "now" ? "Live / Current" : `Forecast +${forecastHorizon}`}</span>
                <span>•</span>
                <span>{fmtTime(latest?.tsMs ?? null)}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className={`rounded-full px-3 py-2 text-xs font-extrabold ${floodBadgeClasses(
                  flood.label
                )}`}
              >
                {flood.label}
              </span>
              <span
                className={`rounded-full px-3 py-2 text-xs font-extrabold ${rainBadgeClasses(
                  rainStatus.label
                )}`}
              >
                RAIN {rainStatus.label}
              </span>
              <span
                className={`rounded-full px-3 py-2 text-xs font-extrabold ${badgeToneClasses(
                  dataQuality.tone
                )}`}
                title={dataQuality.note}
              >
                {dataQuality.label}
              </span>
            </div>
          </div>

          {summaryError ? (
            <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
              {summaryError}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label="Current Flood"
            value={`${fmt(currentRisk.scenario.floodDepthCm, 1)} cm`}
            detail={flood.note}
            tone={flood.label === "DANGER" ? "bad" : flood.label === "WARNING" ? "warn" : "default"}
          />
          <MetricTile
            label="Rain Rate (5m)"
            value={
              latest?.rainRateMmHr300 != null
                ? `${fmt(latest.rainRateMmHr300, 1)} mm/hr`
                : "—"
            }
            detail={rainStatus.note}
            tone={rainStatus.label === "EXTREME" || rainStatus.label === "VERY HEAVY" ? "bad" : rainStatus.label === "HEAVY" ? "warn" : "default"}
          />
          <MetricTile
            label="Scenario Depth"
            value={`${fmt(scenarioRisk.scenario.floodDepthCm, 1)} cm`}
            detail={
              forecastHorizon === "now"
                ? "Live mode"
                : `Δ ${forecastDeltaDepth >= 0 ? "+" : ""}${fmt(forecastDeltaDepth, 1)} cm`
            }
            tone={forecastDeltaDepth > 0 ? "warn" : "default"}
          />
          <MetricTile
            label="Scenario Risk"
            value={scenarioRisk.dynamicRisk.toFixed(3)}
            detail={getStageLabel(scenarioRisk.riskStage)}
            tone={
              scenarioRisk.dynamicRisk > 0.6
                ? "bad"
                : scenarioRisk.dynamicRisk > 0.3
                ? "warn"
                : "ok"
            }
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
          <SectionCard
            title="Current vs Forecast Scenario"
            subtitle="Important computations are retained: rain memory, current risk, scenario risk, flood stage, and activation."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <MetricTile
                label="Projected Rain"
                value={
                  forecastHorizon === "now"
                    ? "—"
                    : `${fmt(scenarioRisk.scenario.projectedRainMm, 1)} mm`
                }
                detail="Scenario accumulation if current rain persists"
              />
              <MetricTile
                label="Stable Water"
                value={stableCm != null ? `${fmt(stableCm, 1)} cm` : "—"}
                detail={stableCm != null ? `${fmt(stableCm / 30.48, 2)} ft filtered` : "No stable value"}
              />
              <MetricTile
                label="Activation"
                value={activation.on ? "ON" : "OFF"}
                detail={activation.reason}
                tone={activation.on ? "warn" : "default"}
              />
              <MetricTile
                label="Raw Distance"
                value={latest?.rawDistCm != null ? `${fmt(latest.rawDistCm, 1)} cm` : "—"}
                detail={
                  latest?.dryDistanceCm != null
                    ? `Dry distance ${fmt(latest.dryDistanceCm, 1)} cm`
                    : selectedSensor.dryDistanceCm != null
                    ? `Dry distance ${fmt(selectedSensor.dryDistanceCm, 1)} cm`
                    : "No dry distance"
                }
              />
              <MetricTile
                label="Rain Memory"
                value={rainMemory.toFixed(3)}
                detail="Persistence memory used by the risk engine"
              />
              <MetricTile
                label="Risk Delta"
                value={
                  forecastHorizon === "now"
                    ? "—"
                    : `${forecastDeltaRisk >= 0 ? "+" : ""}${forecastDeltaRisk.toFixed(3)}`
                }
                detail="Scenario risk minus current risk"
                tone={forecastDeltaRisk > 0 ? "warn" : "default"}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Sensor Health"
            subtitle="Compact operational status for ultrasonic, overflow, signal, battery, and activation."
          >
            <div className="flex flex-wrap gap-2">
              {healthPills.map((p) => (
                <span
                  key={p.text}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${badgeToneClasses(
                    p.tone
                  )}`}
                >
                  {p.text}
                </span>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Flood Status
                </div>
                <div className="mt-1 font-bold text-zinc-900">{flood.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{flood.note}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Rain Status
                </div>
                <div className="mt-1 font-bold text-zinc-900">{rainStatus.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{rainStatus.note}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Overflow
                </div>
                <div className="mt-1 font-bold text-zinc-900">{latestOverflow ? "Yes" : "No"}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Latest Timestamp
                </div>
                <div className="mt-1 font-bold text-zinc-900">{fmtTime(latest?.tsMs ?? null)}</div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
          <SectionCard
            title="Weather"
            subtitle={`${selectedSensor.name} • ${selectedSensor.lat.toFixed(5)}, ${selectedSensor.lng.toFixed(5)} • Asia/Manila`}
            action={
              <button
                type="button"
                onClick={() => void loadWeather()}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Refresh
              </button>
            }
          >
            {weatherError ? (
              <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
                {weatherError}
              </div>
            ) : weatherLoading && !weather ? (
              <div className="text-sm text-zinc-600">Loading weather…</div>
            ) : !weather ? (
              <div className="text-sm text-zinc-600">No weather data.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <MetricTile
                  label="Current Precipitation"
                  value={
                    weather.current.precipitation_mm == null
                      ? "—"
                      : `${weather.current.precipitation_mm.toFixed(1)} mm`
                  }
                  detail={`Updated ${fmtTime(weather.fetchedAt)}`}
                />
                <MetricTile
                  label="Next 1 Hour"
                  value={
                    weather.hourly.precipitation_mm?.[0] != null
                      ? `${Number(weather.hourly.precipitation_mm[0]).toFixed(1)} mm`
                      : "—"
                  }
                  detail={
                    weather.hourly.precip_prob?.[0] != null
                      ? `Probability ${Math.round(weather.hourly.precip_prob[0])}%`
                      : "Probability —"
                  }
                />
                <MetricTile
                  label="Next 3 Hours"
                  value={
                    weather.hourly.precipitation_mm?.length >= 3
                      ? `${(
                          Number(weather.hourly.precipitation_mm[0] ?? 0) +
                          Number(weather.hourly.precipitation_mm[1] ?? 0) +
                          Number(weather.hourly.precipitation_mm[2] ?? 0)
                        ).toFixed(1)} mm`
                      : "—"
                  }
                  detail="Open-Meteo sum"
                />
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Rain Details"
            subtitle={`Tipping bucket calibration retained at ${MM_PER_TIP} mm/tip.`}
          >
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
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

              <dt className="text-zinc-500">Total Ticks</dt>
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
              <dd className="text-right font-bold text-zinc-900">{latest?.networkType ?? "—"}</dd>
            </dl>

            <div className="mt-3 text-xs text-zinc-500">
              Forecast mode uses projected rainfall total and the same risk engine.
              It does not fake a projected 5-minute rate.
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Report Summary"
          subtitle={`Summary for ${selectedSensor.name} under ${forecastHorizon === "now" ? "live conditions" : `forecast ${forecastHorizon}`}.`}
        >
          <div className="grid gap-2 text-sm text-zinc-800">
            <div>• {reportSummary.freshness}</div>
            <div>• {reportSummary.rain}</div>
            <div>• {reportSummary.depth}</div>
            <div>• {reportSummary.activation}</div>
            <div>• {reportSummary.waterStatus}</div>
            <div>• {reportSummary.risk}</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Raw Records"
          subtitle="Choose a sensor and row count for database-backed raw logs."
          action={
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
            >
              {showLogs ? "Hide Logs" : "Show Logs"}
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold text-zinc-700">
              <span>Logs Sensor</span>
              <select
                value={logsDeviceId}
                onChange={(e) => setLogsDeviceId(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
              >
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name} — {sensor.zoneLabel}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-zinc-700">
              <span>Rows</span>
              <select
                value={logsLimit}
                onChange={(e) => setLogsLimit(Number(e.target.value))}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
              >
                {LOG_LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} rows
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-1 text-sm font-semibold text-zinc-700">
              <span>Quick Sync</span>
              <button
                type="button"
                onClick={() => setLogsDeviceId(selectedDeviceId)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                Use Main Sensor
              </button>
            </div>
          </div>

          {!showLogs ? (
            <div className="mt-4 text-sm text-zinc-600">
              Logs are hidden by default for performance. Open them only when needed.
            </div>
          ) : recent.length === 0 && !logsLoading ? (
            <div className="mt-4 text-sm text-zinc-600">
              No logs found for {selectedLogsSensor?.name ?? "this sensor"}.
            </div>
          ) : (
            <>
              <div className="mt-4 md:hidden space-y-3">
                {logsLoading && recent.length === 0 ? (
                  <div className="text-sm text-zinc-600">Loading logs…</div>
                ) : (
                  recent.map((p, idx) => {
                    const rowActivated =
                      !p.isStale &&
                      (Boolean(p.overflow) ||
                        (p.tips60 ?? 0) > 0 ||
                        (p.floodDepthCm ?? 0) >= DEPTH_ON_CM);

                    return (
                      <div
                        key={`${p.tsMs ?? "no-ts"}-${idx}`}
                        className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-bold text-zinc-900">
                            {fmtTime(p.tsMs)}
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeToneClasses(
                              p.isStale ? "warn" : "ok"
                            )}`}
                          >
                            {p.isStale ? "STALE" : "LIVE"}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-700">
                          <div>Tips60: <span className="font-bold">{fmtInt(p.tips60)}</span></div>
                          <div>Tips300: <span className="font-bold">{fmtInt(p.tips300)}</span></div>
                          <div>Rain60: <span className="font-bold">{p.rainMm60 != null ? fmt(p.rainMm60, 2) : "—"}</span></div>
                          <div>Rain300: <span className="font-bold">{p.rainMm300 != null ? fmt(p.rainMm300, 2) : "—"}</span></div>
                          <div>Rate60: <span className="font-bold">{p.rainRateMmHr60 != null ? fmt(p.rainRateMmHr60, 1) : "—"}</span></div>
                          <div>Rate300: <span className="font-bold">{p.rainRateMmHr300 != null ? fmt(p.rainRateMmHr300, 1) : "—"}</span></div>
                          <div>FloodDepth: <span className="font-bold">{p.floodDepthCm != null ? fmt(p.floodDepthCm, 1) : "—"}</span></div>
                          <div>RawDist: <span className="font-bold">{p.rawDistCm != null ? fmt(p.rawDistCm, 1) : "—"}</span></div>
                          <div>US Valid: <span className="font-bold">{p.usValid == null ? "—" : p.usValid ? "true" : "false"}</span></div>
                          <div>Accepted: <span className="font-bold">{p.acceptedForStable == null ? "—" : p.acceptedForStable ? "true" : "false"}</span></div>
                          <div>Overflow: <span className="font-bold">{p.overflow == null ? "—" : p.overflow ? "true" : "false"}</span></div>
                          <div>Activated: <span className="font-bold">{rowActivated ? "ON" : "OFF"}</span></div>
                          <div>Battery: <span className="font-bold">{p.batteryPercentage != null ? `${fmtInt(p.batteryPercentage)}%` : "—"}</span></div>
                          <div>RSSI: <span className="font-bold">{p.rssiDbm != null ? fmtInt(p.rssiDbm) : "—"}</span></div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-4 hidden md:block overflow-x-auto">
                <table className="min-w-[1220px] w-full text-left text-xs">
                  <thead className="bg-zinc-50 text-zinc-700">
                    <tr>
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
                        <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logsLoading && recent.length === 0 ? (
                      <tr>
                        <td colSpan={16} className="px-3 py-6 text-sm text-zinc-500">
                          Loading logs…
                        </td>
                      </tr>
                    ) : (
                      recent.map((p, idx) => {
                        const rowActivated =
                          !p.isStale &&
                          (Boolean(p.overflow) ||
                            (p.tips60 ?? 0) > 0 ||
                            (p.floodDepthCm ?? 0) >= DEPTH_ON_CM);

                        return (
                          <tr
                            key={`${p.tsMs ?? "no-ts"}-${idx}`}
                            className="border-t border-zinc-100 text-zinc-900"
                          >
                            <td className="whitespace-nowrap px-3 py-3">{fmtTime(p.tsMs)}</td>
                            <td className="px-3 py-3">{p.isStale ? "YES" : "NO"}</td>
                            <td className="px-3 py-3">{fmtInt(p.tips60)}</td>
                            <td className="px-3 py-3">{p.rainMm60 != null ? fmt(p.rainMm60, 2) : "—"}</td>
                            <td className="px-3 py-3">{p.rainRateMmHr60 != null ? fmt(p.rainRateMmHr60, 1) : "—"}</td>
                            <td className="px-3 py-3">{fmtInt(p.tips300)}</td>
                            <td className="px-3 py-3">{p.rainMm300 != null ? fmt(p.rainMm300, 2) : "—"}</td>
                            <td className="px-3 py-3">{p.rainRateMmHr300 != null ? fmt(p.rainRateMmHr300, 1) : "—"}</td>
                            <td className="px-3 py-3">{p.floodDepthCm != null ? fmt(p.floodDepthCm, 1) : "—"}</td>
                            <td className="px-3 py-3">{p.rawDistCm != null ? fmt(p.rawDistCm, 1) : "—"}</td>
                            <td className="px-3 py-3">{p.usValid == null ? "—" : p.usValid ? "true" : "false"}</td>
                            <td className="px-3 py-3">
                              {p.acceptedForStable == null
                                ? "—"
                                : p.acceptedForStable
                                ? "true"
                                : "false"}
                            </td>
                            <td className="px-3 py-3">{p.overflow == null ? "—" : p.overflow ? "true" : "false"}</td>
                            <td className="px-3 py-3">
                              {p.batteryPercentage != null ? `${fmtInt(p.batteryPercentage)}%` : "—"}
                            </td>
                            <td className="px-3 py-3">{p.rssiDbm != null ? fmtInt(p.rssiDbm) : "—"}</td>
                            <td className="px-3 py-3">{rowActivated ? "ON" : "OFF"}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}