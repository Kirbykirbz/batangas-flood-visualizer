"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, Point } from "geojson";
import "leaflet/dist/leaflet.css";

import type { SensorPoint } from "@/app/lib/sensorStore";
import {
  extractBatteryPercentage,
  extractFloodDepthCm,
  extractRainMmHr,
  extractRssiDbm,
  extractTimestampMs,
  isOverflow,
} from "@/app/lib/sensorReading";
import {
  clamp01,
  computeFloodRisk,
  getRiskColor,
  getStageLabel,
  type ForecastHorizon,
} from "@/app/lib/floodForecast";

type SensorDevice = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoneLabel: string;
};

type BaseMapMode = "street" | "satellite";
type MapLockTarget = "selectedSensor" | "user";

type FloodMapProps = {
  geoJsonData: FeatureCollection<Point, { z: number }>;
  devices: SensorDevice[];
  selectedDeviceId: string;
  userPosition: { lat: number; lng: number } | null;
  forecastHorizon: ForecastHorizon;
  onSelectDevice: (deviceId: string) => void;
};

type ApiDataPayload = {
  latest: SensorPoint | null;
  recent: SensorPoint[];
  latestByDevice?: Record<string, SensorPoint>;
  serverTime: number;
};

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtTime(tsMs: number | null) {
  if (!tsMs) return "—";
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function MapFocusController({
  center,
  focusTarget,
  onFocusHandled,
}: {
  center: [number, number];
  focusTarget: { lat: number; lng: number } | null;
  onFocusHandled: () => void;
}) {
  const map = useMap();
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (focusTarget) {
      const key = `focus:${focusTarget.lat},${focusTarget.lng}`;
      if (lastKeyRef.current === key) return;

      lastKeyRef.current = key;
      map.flyTo([focusTarget.lat, focusTarget.lng], Math.max(map.getZoom(), 17), {
        duration: 0.8,
      });
      onFocusHandled();
      return;
    }

    const key = `center:${center[0]},${center[1]}`;
    if (lastKeyRef.current === key) return;

    lastKeyRef.current = key;
    map.flyTo(center, map.getZoom(), { duration: 0.6 });
  }, [map, center, focusTarget, onFocusHandled]);

  return null;
}

function StagePanes() {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane("stage-prev")) {
      map.createPane("stage-prev");
      const pane = map.getPane("stage-prev");
      if (pane) pane.style.zIndex = "300";
    }

    if (!map.getPane("stage-current")) {
      map.createPane("stage-current");
      const pane = map.getPane("stage-current");
      if (pane) pane.style.zIndex = "301";
    }
  }, [map]);

  return null;
}

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

const selectedSensorIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:24px;
      height:24px;
      border-radius:9999px;
      background:#111827;
      border:4px solid #ffffff;
      box-shadow:0 0 0 4px rgba(17,24,39,0.22);
    "></div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const sensorIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:18px;
      height:18px;
      border-radius:9999px;
      background:#2563eb;
      border:3px solid #ffffff;
      box-shadow:0 0 0 2px rgba(37,99,235,0.20);
    "></div>
  `,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export default function FixedFloodMapInner({
  geoJsonData,
  devices,
  selectedDeviceId,
  userPosition,
  forecastHorizon,
  onSelectDevice,
}: FloodMapProps) {
  void geoJsonData;

  const [latestByDevice, setLatestByDevice] = useState<Record<string, SensorPoint>>({});
  const [rainMemory, setRainMemory] = useState(0);
  const [hudOpen, setHudOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>("street");
  const [mapLockTarget, setMapLockTarget] = useState<MapLockTarget>("selectedSensor");

  const [displayStage, setDisplayStage] = useState<0 | 1 | 2 | 3>(0);
  const [previousStage, setPreviousStage] = useState<0 | 1 | 2 | 3>(0);
  const [previousStageOpacity, setPreviousStageOpacity] = useState(0);

  const displayStageRef = useRef<0 | 1 | 2 | 3>(0);
  const lastUpdateRef = useRef<number | null>(null);

  const BATANGAS_BOUNDS: [[number, number], [number, number]] = [
    [13.63, 121.0],
    [13.83, 121.15],
  ];

  const RAIN_FULL_MMHR = 50;
  const DEPTH_FULL_CM = 30;
  const TAU_MIN = 60;
  const DEPTH_DAMP_BASE = 0.2;
  const DEPTH_ON_CM = 5;

  useEffect(() => {
    function updateMobile() {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      setHudOpen(!mobile);
      setLegendOpen(!mobile);
    }

    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  useEffect(() => {
    displayStageRef.current = displayStage;
  }, [displayStage]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? devices[0] ?? null,
    [devices, selectedDeviceId]
  );

  const selectedSensorCenter = useMemo<[number, number]>(() => {
    if (selectedDevice) return [selectedDevice.lat, selectedDevice.lng];
    return [13.735412678211276, 121.07296804092847];
  }, [selectedDevice]);

  const activeCenter = useMemo<[number, number]>(() => {
    if (mapLockTarget === "user" && userPosition) {
      return [userPosition.lat, userPosition.lng];
    }
    return selectedSensorCenter;
  }, [mapLockTarget, userPosition, selectedSensorCenter]);

  useEffect(() => {
    let cancelled = false;

    async function loadLatest() {
      try {
        const res = await fetch(`/api/data?limit=300&t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;

        const json = (await res.json()) as ApiDataPayload;
        if (!cancelled) {
          setLatestByDevice(json.latestByDevice ?? {});
        }
      } catch (e) {
        console.error("Failed to load latest sensor data:", e);
      }
    }

    loadLatest();
    const id = window.setInterval(loadLatest, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const selectedLatest = useMemo(
    () => (selectedDeviceId ? latestByDevice[selectedDeviceId] ?? null : null),
    [latestByDevice, selectedDeviceId]
  );

  const floodDepthCmCurrent = useMemo(() => extractFloodDepthCm(selectedLatest), [selectedLatest]);
  const rainMmHrCurrent = useMemo(() => extractRainMmHr(selectedLatest), [selectedLatest]);
  const tsMs = useMemo(() => extractTimestampMs(selectedLatest), [selectedLatest]);
  const selectedOverflow = useMemo(() => isOverflow(selectedLatest), [selectedLatest]);

  useEffect(() => {
    const now = Date.now();
    const last = lastUpdateRef.current;
    lastUpdateRef.current = now;

    const rainFactorCurrent = clamp01(rainMmHrCurrent / RAIN_FULL_MMHR);

    const rafId = window.requestAnimationFrame(() => {
      setRainMemory((prev) => {
        if (last == null) return rainFactorCurrent;

        const dtMin = (now - last) / 60000;
        const decay = Math.exp(-dtMin / TAU_MIN);
        return Math.max(rainFactorCurrent, prev * decay);
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [rainMmHrCurrent]);

  const selectedRisk = useMemo(() => {
    return computeFloodRisk({
      forecastHorizon,
      rainMmHrCurrent,
      floodDepthCmCurrent,
      rainMemory,
      rainFullMmHr: RAIN_FULL_MMHR,
      depthFullCm: DEPTH_FULL_CM,
      depthOnCm: DEPTH_ON_CM,
      depthDampBase: DEPTH_DAMP_BASE,
      overflow: selectedOverflow,
    });
  }, [
    forecastHorizon,
    rainMmHrCurrent,
    floodDepthCmCurrent,
    rainMemory,
    selectedOverflow,
  ]);

  const dynamicRisk = selectedRisk.dynamicRisk;
  const active = selectedRisk.active;
  const riskStage = selectedRisk.riskStage;
  const riskColor = getRiskColor(dynamicRisk);
  const scenarioMetrics = selectedRisk.scenario;
  const effectiveDepthFactor = selectedRisk.effectiveDepthFactor;

  useEffect(() => {
    if (riskStage === displayStageRef.current) return;

    const fadeDurationMs = 450;
    let fadeIntervalId: number | null = null;
    let cleanupTimeoutId: number | null = null;
    let rafId: number | null = null;

    setPreviousStage(displayStageRef.current);
    setPreviousStageOpacity(displayStageRef.current === 0 ? 0 : 0.85);
    setDisplayStage(riskStage);

    rafId = window.requestAnimationFrame(() => {
      const start = performance.now();

      fadeIntervalId = window.setInterval(() => {
        const elapsed = performance.now() - start;
        const progress = Math.min(elapsed / fadeDurationMs, 1);
        const nextOpacity = 0.85 * (1 - progress);
        setPreviousStageOpacity(nextOpacity);

        if (progress >= 1 && fadeIntervalId != null) {
          window.clearInterval(fadeIntervalId);
        }
      }, 16);

      cleanupTimeoutId = window.setTimeout(() => {
        setPreviousStage(0);
        setPreviousStageOpacity(0);
      }, fadeDurationMs + 40);
    });

    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (fadeIntervalId != null) window.clearInterval(fadeIntervalId);
      if (cleanupTimeoutId != null) window.clearTimeout(cleanupTimeoutId);
    };
  }, [riskStage]);

  const currentStageTileUrl = useMemo(() => {
    if (displayStage === 0) return null;
    return `/tiles/risk-stage-${displayStage}/{z}/{x}/{y}.png`;
  }, [displayStage]);

  const previousStageTileUrl = useMemo(() => {
    if (previousStage === 0) return null;
    return `/tiles/risk-stage-${previousStage}/{z}/{x}/{y}.png`;
  }, [previousStage]);

  return (
    <div className="relative">
      <div
        className={`absolute right-3 top-3 z-[1001] ${
          isMobile ? "flex flex-col gap-2" : "flex flex-wrap gap-2"
        }`}
      >
        <button
          type="button"
          onClick={() => setBaseMapMode((v) => (v === "street" ? "satellite" : "street"))}
          className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-zinc-800 shadow ring-1 ring-zinc-200 sm:text-xs"
        >
          {baseMapMode === "street" ? "Satellite" : "Street"}
        </button>

        {userPosition && (
          <button
            type="button"
            onClick={() => {
              setMapLockTarget("user");
              setFocusTarget({ lat: userPosition.lat, lng: userPosition.lng });
            }}
            className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-zinc-800 shadow ring-1 ring-zinc-200 sm:text-xs"
          >
            Locate Me
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setMapLockTarget("selectedSensor");
            if (selectedDevice) {
              setFocusTarget({ lat: selectedDevice.lat, lng: selectedDevice.lng });
            }
          }}
          className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-zinc-800 shadow ring-1 ring-zinc-200 sm:text-xs"
        >
          Go to Sensor
        </button>

        <button
          type="button"
          onClick={() => setHudOpen((v) => !v)}
          className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-zinc-800 shadow ring-1 ring-zinc-200 sm:text-xs"
        >
          {hudOpen ? "Hide Info" : "Show Info"}
        </button>
      </div>

      <div className="absolute left-12 top-3 z-[1001]">
        <div
          className={`rounded-xl px-3 py-2 text-[11px] font-extrabold shadow ring-1 sm:text-xs ${
            active
              ? "bg-red-50 text-red-700 ring-red-200"
              : "bg-zinc-50 text-zinc-700 ring-zinc-200"
          }`}
        >
          {active ? "Flood Zone Active" : "Flood Zone Inactive"}
        </div>
      </div>

      <div className="absolute left-3 bottom-3 z-[1001]">
        {isMobile ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setLegendOpen((v) => !v)}
              className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-zinc-800 shadow ring-1 ring-zinc-200"
            >
              {legendOpen ? "Hide Legend" : "Show Legend"}
            </button>

            {legendOpen && (
              <div className="max-w-[220px] rounded-xl bg-white/95 px-3 py-3 shadow ring-1 ring-zinc-200">
                <div className="text-[11px] font-extrabold text-zinc-900">Map Legend</div>
                <div className="mt-2 space-y-2 text-[11px] text-zinc-700">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                    <span>Your location</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-zinc-900" />
                    <span>Selected sensor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />
                    <span>Other sensors</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-8 rounded bg-green-500" />
                    <span>Low Flood</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-8 rounded bg-orange-500" />
                    <span>Medium Flood</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-8 rounded bg-red-600" />
                    <span>High Flood</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-[250px] rounded-xl bg-white/95 px-4 py-3 shadow ring-1 ring-zinc-200">
            <div className="text-xs font-extrabold text-zinc-900">Map Legend</div>
            <div className="mt-2 space-y-2 text-xs text-zinc-700">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                <span>Your location</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-zinc-900" />
                <span>Selected sensor</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />
                <span>Other sensors</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-8 rounded bg-green-500" />
                <span>Low Flood</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-8 rounded bg-orange-500" />
                <span>Medium Flood</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-8 rounded bg-red-600" />
                <span>High Flood</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {hudOpen && (
        <div
          className={`absolute z-[1000] rounded-xl bg-white/95 px-4 py-3 shadow ring-1 ring-zinc-200 ${
            isMobile ? "left-3 right-3 top-32 max-w-none" : "right-3 top-14 max-w-[360px]"
          }`}
        >
          <div className="text-xs font-semibold text-zinc-500">
            {forecastHorizon === "now"
              ? "Selected Sensor — Live"
              : `Selected Sensor — Forecast ${forecastHorizon}`}
          </div>

          <div className="mt-1 text-sm font-bold text-zinc-900">
            {selectedDevice?.name ?? "—"} • Risk: {dynamicRisk.toFixed(3)}
          </div>

          <div className="mt-1 text-xs text-zinc-700">
            Stage: <span className="font-semibold">{getStageLabel(displayStage)}</span>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Rain: <span className="font-semibold">{fmt(scenarioMetrics.rainMmHr, 1)}</span> mm/hr
          </div>

          <div className="text-xs text-zinc-700">
            Flood depth:{" "}
            <span className="font-semibold">{fmt(scenarioMetrics.floodDepthCm, 1)}</span> cm
          </div>

          <div className="text-xs text-zinc-700">
            Overflow: <span className="font-semibold">{selectedOverflow ? "Yes" : "No"}</span>
          </div>

          {forecastHorizon !== "now" && (
            <>
              <div className="mt-2 text-xs text-zinc-700">
                Projected rain:{" "}
                <span className="font-semibold">{fmt(scenarioMetrics.projectedRainMm, 1)}</span> mm
              </div>
              <div className="text-xs text-zinc-700">
                Rain contribution:{" "}
                <span className="font-semibold">
                  {fmt(scenarioMetrics.rainfallContributionCm, 1)}
                </span>{" "}
                cm
              </div>
              <div className="text-xs text-zinc-700">
                Drainage loss:{" "}
                <span className="font-semibold">{fmt(scenarioMetrics.drainageLossCm, 1)}</span> cm
              </div>
            </>
          )}

          <div className="mt-2 text-xs text-zinc-700">
            Risk color:{" "}
            <span className="font-semibold" style={{ color: riskColor }}>
              {riskColor}
            </span>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            RainMem: {rainMemory.toFixed(3)} • EffDepth: {effectiveDepthFactor.toFixed(3)}
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            RSSI: <span className="font-semibold">{fmt(extractRssiDbm(selectedLatest), 0)}</span> dBm
          </div>

          <div className="text-xs text-zinc-700">
            Battery:{" "}
            <span className="font-semibold">
              {fmt(extractBatteryPercentage(selectedLatest), 0)}
            </span>
            %
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            Updated: {fmtTime(tsMs)}
          </div>
        </div>
      )}

      <MapContainer
        center={activeCenter}
        zoom={15}
        minZoom={12}
        maxZoom={21}
        scrollWheelZoom
        maxBounds={BATANGAS_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{
          height: isMobile ? "68vh" : "80vh",
          width: "100%",
          borderRadius: "8px",
        }}
      >
        <MapFocusController
          center={activeCenter}
          focusTarget={focusTarget}
          onFocusHandled={() => setFocusTarget(null)}
        />

        <StagePanes />

        {baseMapMode === "street" ? (
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            maxNativeZoom={20}
            maxZoom={21}
          />
        ) : (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxNativeZoom={19}
            maxZoom={21}
          />
        )}

        {previousStageTileUrl && previousStageOpacity > 0.001 && (
          <TileLayer
            key={`prev-stage-${previousStage}`}
            url={previousStageTileUrl}
            opacity={previousStageOpacity}
            pane="stage-prev"
            minNativeZoom={12}
            maxNativeZoom={18}
            maxZoom={21}
          />
        )}

        {currentStageTileUrl && (
          <TileLayer
            key={`current-stage-${displayStage}-${forecastHorizon}`}
            url={currentStageTileUrl}
            opacity={0.85}
            pane="stage-current"
            minNativeZoom={12}
            maxNativeZoom={18}
            maxZoom={21}
          />
        )}

        {userPosition && (
          <CircleMarker
            center={[userPosition.lat, userPosition.lng]}
            radius={9}
            pathOptions={{
              color: "#b91c1c",
              fillColor: "#ef4444",
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Popup>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Your Location</div>
                <div>
                  <b>Latitude</b>: {userPosition.lat.toFixed(6)}
                </div>
                <div>
                  <b>Longitude</b>: {userPosition.lng.toFixed(6)}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        )}

        {devices.map((device) => {
          const isSelected = device.id === selectedDeviceId;
          const deviceLatest = latestByDevice[device.id] ?? null;

          const deviceRain = extractRainMmHr(deviceLatest);
          const deviceDepth = extractFloodDepthCm(deviceLatest);
          const deviceTs = extractTimestampMs(deviceLatest);
          const deviceOverflow = isOverflow(deviceLatest);

          const deviceRainFactorCurrent = clamp01(deviceRain / RAIN_FULL_MMHR);
          const deviceRainMemory = clamp01(0.55 * deviceRainFactorCurrent + 0.45 * rainMemory);

          const deviceRisk = computeFloodRisk({
            forecastHorizon,
            rainMmHrCurrent: deviceRain,
            floodDepthCmCurrent: deviceDepth,
            rainMemory: deviceRainMemory,
            rainFullMmHr: RAIN_FULL_MMHR,
            depthFullCm: DEPTH_FULL_CM,
            depthOnCm: DEPTH_ON_CM,
            depthDampBase: DEPTH_DAMP_BASE,
            overflow: deviceOverflow,
          });

          return (
            <Marker
              key={device.id}
              position={[device.lat, device.lng]}
              icon={isSelected ? selectedSensorIcon : sensorIcon}
              eventHandlers={{
                click: () => {
                  setMapLockTarget("selectedSensor");
                  onSelectDevice(device.id);
                  setFocusTarget({ lat: device.lat, lng: device.lng });
                },
              }}
            >
              {isSelected && (
                <Tooltip direction="top" offset={[0, -10]} permanent>
                  <span className="font-semibold">{device.name}</span>
                </Tooltip>
              )}

              <Popup>
                <div style={{ minWidth: 240 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {device.name} {isSelected ? "(Selected)" : ""}
                  </div>

                  <div>
                    <b>Zone</b>: {device.zoneLabel}
                  </div>

                  <div>
                    <b>Device ID</b>: {device.id}
                  </div>

                  <hr style={{ margin: "10px 0" }} />

                  {deviceLatest ? (
                    <>
                      <div>
                        <b>Scenario</b>: {forecastHorizon === "now" ? "Now" : `+${forecastHorizon}`}
                      </div>
                      <div>
                        <b>Rain</b>: {fmt(deviceRisk.scenario.rainMmHr, 1)} mm/hr
                      </div>
                      <div>
                        <b>Flood depth</b>: {fmt(deviceRisk.scenario.floodDepthCm, 1)} cm
                      </div>
                      <div>
                        <b>Risk</b>: {deviceRisk.dynamicRisk.toFixed(3)}
                      </div>
                      <div>
                        <b>Stage</b>: {getStageLabel(deviceRisk.riskStage)}
                      </div>
                      <div>
                        <b>Overflow</b>: {deviceOverflow ? "Yes" : "No"}
                      </div>
                      <div>
                        <b>Updated</b>: {fmtTime(deviceTs)}
                      </div>
                    </>
                  ) : (
                    <div style={{ color: "#666" }}>No recent telemetry for this sensor.</div>
                  )}

                  {!isSelected && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setMapLockTarget("selectedSensor");
                          onSelectDevice(device.id);
                          setFocusTarget({ lat: device.lat, lng: device.lng });
                        }}
                        style={{
                          border: "1px solid #e4e4e7",
                          background: "white",
                          padding: "6px 10px",
                          borderRadius: "10px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Select this sensor
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}