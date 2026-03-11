// app/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, Feature, Point } from "geojson";
import FixedFloodMap from "@/components/FixedFloodMap";

type SensorDevice = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoneLabel: string;
};

type AnyPoint = Record<string, unknown>;

type Payload = {
  latest: AnyPoint | null;
  recent: AnyPoint[];
  latestByDevice?: Record<string, AnyPoint>;
  serverTime: number;
};

type ForecastHorizon = "now" | "2h" | "4h" | "6h" | "8h";
type WarningLevel = "NORMAL" | "WATCH" | "WARNING" | "DANGER";

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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

function classifyWarning(depthCm: number): WarningLevel {
  if (depthCm >= 30) return "DANGER";
  if (depthCm >= 20) return "WARNING";
  if (depthCm >= 10) return "WATCH";
  return "NORMAL";
}

function warningBadgeClasses(level: WarningLevel) {
  switch (level) {
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

function rainLabel(mmHr: number): string {
  if (mmHr < 0.5) return "No Rain";
  if (mmHr < 2.5) return "Light";
  if (mmHr < 7.5) return "Moderate";
  if (mmHr < 15) return "Heavy";
  if (mmHr < 30) return "Very Heavy";
  return "Extreme";
}

function horizonToHours(h: ForecastHorizon): number {
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

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);

  const a = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export default function DashboardPage() {
  const emptyPoints = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: [] as Array<Feature<Point, { z: number }>>,
      }) satisfies FeatureCollection<Point, { z: number }>,
    []
  );

  const devices: SensorDevice[] = useMemo(
    () => [
      {
        id: "esp32-1",
        name: "Sensor 1",
        lat: 13.735412678211276,
        lng: 121.07296804092847,
        zoneLabel: "Primary test zone",
      },
      {
        id: "esp32-2",
        name: "Sensor 2",
        lat: 13.7415,
        lng: 121.0675,
        zoneLabel: "Future placement",
      },
      {
        id: "esp32-3",
        name: "Sensor 3",
        lat: 13.7295,
        lng: 121.0795,
        zoneLabel: "Future placement",
      },
    ],
    []
  );

  const [latestByDevice, setLatestByDevice] = useState<Record<string, AnyPoint>>({});
  const [manualSelectedDeviceId, setManualSelectedDeviceId] = useState<string>("");
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>("now");
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [lastPollMs, setLastPollMs] = useState<number>(0);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {},
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLatest() {
      try {
        const res = await fetch(`/api/data?limit=300&t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json: Payload = await res.json();
        if (!cancelled) {
          setLatestByDevice(json.latestByDevice ?? {});
          setLastPollMs(json.serverTime ?? Date.now());
        }
      } catch {
        //
      }
    }

    loadLatest();
    const id = window.setInterval(loadLatest, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const nearestDevice = useMemo(() => {
    if (!userPosition || devices.length === 0) return null;

    let nearest = devices[0];
    let nearestDist = distanceMeters(userPosition.lat, userPosition.lng, nearest.lat, nearest.lng);

    for (const d of devices.slice(1)) {
      const dist = distanceMeters(userPosition.lat, userPosition.lng, d.lat, d.lng);
      if (dist < nearestDist) {
        nearest = d;
        nearestDist = dist;
      }
    }

    return nearest;
  }, [userPosition, devices]);

  const selectedDeviceId = useMemo(() => {
    if (manualSelectedDeviceId) return manualSelectedDeviceId;
    if (nearestDevice) return nearestDevice.id;
    return devices[0]?.id ?? "";
  }, [manualSelectedDeviceId, nearestDevice, devices]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? devices[0] ?? null,
    [devices, selectedDeviceId]
  );

  const selectedLatest = useMemo(
    () => (selectedDeviceId ? latestByDevice[selectedDeviceId] ?? null : null),
    [latestByDevice, selectedDeviceId]
  );

  const latestTsMs = useMemo(() => {
    if (!selectedLatest) return null;
    return toTsMs(selectedLatest.ts) ?? toTsMs(selectedLatest.created_at) ?? null;
  }, [selectedLatest]);

  const floodDepthCm = useMemo(() => {
    if (!selectedLatest) return null;
    return toNumber(selectedLatest.floodDepthCm) ?? toNumber(selectedLatest.flood_depth_cm) ?? null;
  }, [selectedLatest]);

  const rainRateMmHr = useMemo(() => {
    if (!selectedLatest) return null;
    return (
      toNumber(selectedLatest.rainRateMmHr300) ??
      toNumber(selectedLatest.rain_rate_mmh_300) ??
      toNumber(selectedLatest.rainRateMmHr60) ??
      toNumber(selectedLatest.rain_rate_mmh_60) ??
      null
    );
  }, [selectedLatest]);

  const isLive = useMemo(() => {
    if (!latestTsMs || !lastPollMs) return false;
    return lastPollMs - latestTsMs <= 15000;
  }, [latestTsMs, lastPollMs]);

  const nearestDistanceMeters = useMemo(() => {
    if (!userPosition || !selectedDevice) return null;
    return distanceMeters(userPosition.lat, userPosition.lng, selectedDevice.lat, selectedDevice.lng);
  }, [userPosition, selectedDevice]);

  const currentWarning = useMemo<WarningLevel>(() => {
    return classifyWarning(floodDepthCm ?? 0);
  }, [floodDepthCm]);

  const scenario = useMemo(() => {
    const currentRain = rainRateMmHr ?? 0;
    const currentDepth = floodDepthCm ?? 0;
    const hours = horizonToHours(forecastHorizon);

    if (forecastHorizon === "now") {
      return {
        projectedRainMm: 0,
        projectedFloodDepthCm: currentDepth,
        projectedWarning: classifyWarning(currentDepth),
        advisory:
          currentDepth > 0 || currentRain > 0
            ? `Current rainfall is ${rainLabel(currentRain).toLowerCase()}. Current flood depth is ${fmt(currentDepth, 1)} cm.`
            : "Conditions are currently calm based on the latest available reading.",
      };
    }

    const projectedRainMm = currentRain * hours;
    const projectedDepth = Math.max(currentDepth, currentDepth + projectedRainMm * 0.35);
    const projectedWarning = classifyWarning(projectedDepth);

    return {
      projectedRainMm,
      projectedFloodDepthCm: projectedDepth,
      projectedWarning,
      advisory: `If current rainfall persists for ${hours} hour${hours > 1 ? "s" : ""}, projected rainfall may reach ${fmt(projectedRainMm, 1)} mm and flood depth may reach about ${fmt(projectedDepth, 1)} cm.`,
    };
  }, [forecastHorizon, rainRateMmHr, floodDepthCm]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Flood Pathway Visualizer
            </div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
              Batangas — Live Flood Overview
            </h1>
            <div className="mt-2 text-sm text-zinc-600">
              See current rain, flood depth, warning level, and scenario projections at a selected sensor location.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/sensor"
              className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-zinc-50"
            >
              Open Sensor Dashboard
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="text-xs font-semibold text-zinc-500">Selected Sensor</div>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setManualSelectedDeviceId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 sm:w-auto"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {d.zoneLabel}
                    </option>
                  ))}
                </select>

                <div className="text-sm text-zinc-600">
                  {userPosition && nearestDistanceMeters != null
                    ? `Nearest distance: ${
                        nearestDistanceMeters < 1000
                          ? `${Math.round(nearestDistanceMeters)} m`
                          : `${(nearestDistanceMeters / 1000).toFixed(2)} km`
                      }`
                    : "Allow location access to auto-select nearest sensor."}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-zinc-500">Scenario Horizon</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["now", "2h", "4h", "6h", "8h"] as ForecastHorizon[]).map((h) => {
                  const active = forecastHorizon === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setForecastHorizon(h)}
                      className={`rounded-xl px-4 py-2 text-sm font-bold shadow-sm ${
                        active
                          ? "bg-zinc-900 text-white"
                          : "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                      }`}
                    >
                      {h === "now" ? "Now" : `+${h}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              {forecastHorizon === "now" ? "Rain Now" : `Projected Rain (${forecastHorizon})`}
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {forecastHorizon === "now"
                ? rainRateMmHr != null
                  ? `${fmt(rainRateMmHr, 1)} mm/hr`
                  : "—"
                : `${fmt(scenario.projectedRainMm, 1)} mm`}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              {forecastHorizon === "now"
                ? `Intensity: ${rainLabel(rainRateMmHr ?? 0)}`
                : "Scenario total rainfall if current state persists"}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              {forecastHorizon === "now" ? "Flood Depth Now" : `Projected Flood Depth (${forecastHorizon})`}
            </div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {forecastHorizon === "now"
                ? floodDepthCm != null
                  ? `${fmt(floodDepthCm, 1)} cm`
                  : "—"
                : `${fmt(scenario.projectedFloodDepthCm, 1)} cm`}
            </div>
            <div className="mt-2 text-sm text-zinc-500">Based on selected sensor</div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">
              {forecastHorizon === "now" ? "Warning Level" : `Projected Warning (${forecastHorizon})`}
            </div>
            <div className="mt-2">
              <span
                className={`inline-flex rounded-full px-4 py-2 text-sm font-extrabold ${warningBadgeClasses(
                  forecastHorizon === "now" ? currentWarning : scenario.projectedWarning
                )}`}
              >
                {forecastHorizon === "now" ? currentWarning : scenario.projectedWarning}
              </span>
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              {isLive ? "Live sensor-based status" : "Latest reading may be stale"}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Selected Sensor</div>
            <div className="mt-2 text-xl font-extrabold tracking-tight text-zinc-900">
              {selectedDevice?.name ?? "—"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">{selectedDevice?.zoneLabel ?? "—"}</div>
            <div className="mt-2 text-sm text-zinc-500">
              {selectedLatest ? (isLive ? "Live telemetry available" : "Latest reading may be stale") : "No recent telemetry for this sensor"}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-base font-extrabold text-zinc-900">Public Advisory</div>
          <div className="mt-2 text-sm text-zinc-700">{scenario.advisory}</div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-2 sm:p-3 shadow-sm">
          <FixedFloodMap
            geoJsonData={emptyPoints}
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            userPosition={userPosition}
            forecastHorizon={forecastHorizon}
            onSelectDevice={setManualSelectedDeviceId}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 shadow-sm">
          <div className="font-extrabold text-zinc-900">What you can do next</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use the sensor selector to switch monitored locations.</li>
            <li>Use the scenario toggle to preview 2h, 4h, 6h, and 8h outcomes if current conditions persist.</li>
            <li>Open the Sensor Dashboard for more detailed technical readings and logs.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
