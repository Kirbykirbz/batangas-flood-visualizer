"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, Layer, LeafletMouseEvent } from "leaflet";
import type {
  FeatureCollection,
  Feature,
  GeoJsonProperties,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import { point as turfPoint } from "@turf/helpers";
import distance from "@turf/distance";
import "leaflet/dist/leaflet.css";

type SensorDevice = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoneLabel: string;
};

type ForecastHorizon = "now" | "2h" | "4h" | "6h" | "8h";

type FloodMapProps = {
  geoJsonData: FeatureCollection<Point, { z: number }>;
  devices: SensorDevice[];
  selectedDeviceId: string;
  userPosition: { lat: number; lng: number } | null;
  forecastHorizon: ForecastHorizon;
  onSelectDevice: (deviceId: string) => void;
};

type LatestReading = {
  ts?: number;
  floodDepthCm?: number | null;
  flood_depth_cm?: number | null;
  rainRateMmHr60?: number | null;
  rain_rate_mmh_60?: number | null;
  rainRateMmHr300?: number | null;
  rain_rate_mmh_300?: number | null;
};

type ApiDataPayload = {
  latest: LatestReading | null;
  recent: LatestReading[];
  latestByDevice?: Record<string, LatestReading>;
  serverTime: number;
};

type ZoneFeature = Feature<Polygon | MultiPolygon, GeoJsonProperties>;
type ZoneFC = FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getRiskColor(risk: number) {
  if (risk <= 0.3) return "green";
  if (risk <= 0.6) return "orange";
  return "red";
}

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
      width:22px;
      height:22px;
      border-radius:9999px;
      background:#111827;
      border:4px solid #ffffff;
      box-shadow:0 0 0 3px rgba(17,24,39,0.25);
    "></div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
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

  const [zoneGeoJson, setZoneGeoJson] = useState<ZoneFC | null>(null);
  const [latestByDevice, setLatestByDevice] = useState<Record<string, LatestReading>>({});
  const [rainMemory, setRainMemory] = useState(0);
  const [hudOpen, setHudOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const lastUpdateRef = useRef<number | null>(null);

  const BATANGAS_BOUNDS: [[number, number], [number, number]] = [
    [13.63, 121.0],
    [13.83, 121.15],
  ];

  useEffect(() => {
    function updateMobile() {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      setHudOpen(!mobile);
    }

    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? devices[0] ?? null,
    [devices, selectedDeviceId]
  );

  const center: LatLngExpression = selectedDevice
    ? [selectedDevice.lat, selectedDevice.lng]
    : [13.735412678211276, 121.07296804092847];

  const RAIN_FULL_MMHR = 50;
  const DEPTH_FULL_CM = 30;
  const TAU_MIN = 60;
  const DEPTH_DAMP_BASE = 0.2;

  useEffect(() => {
    let cancelled = false;

    async function loadZone() {
      try {
        const res = await fetch("/high_flood_zones_highonly.geojson", { cache: "no-store" });
        if (!res.ok) throw new Error(`Zone GeoJSON load failed: ${res.status}`);
        const data = (await res.json()) as ZoneFC;
        if (!cancelled) setZoneGeoJson(data);
      } catch (e) {
        console.error("Failed to load flood zone GeoJSON:", e);
      }
    }

    loadZone();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLatest() {
      try {
        const res = await fetch(`/api/data?limit=300&t=${Date.now()}`, { cache: "no-store" });
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

  const floodDepthCmCurrent = useMemo(() => {
    if (!selectedLatest) return 0;
    return toNumber(selectedLatest.floodDepthCm) ?? toNumber(selectedLatest.flood_depth_cm) ?? 0;
  }, [selectedLatest]);

  const rainMmHrCurrent = useMemo(() => {
    if (!selectedLatest) return 0;
    return (
      toNumber(selectedLatest.rainRateMmHr300) ??
      toNumber(selectedLatest.rain_rate_mmh_300) ??
      toNumber(selectedLatest.rainRateMmHr60) ??
      toNumber(selectedLatest.rain_rate_mmh_60) ??
      0
    );
  }, [selectedLatest]);

  const tsMs = useMemo(() => {
    if (!selectedLatest) return null;
    const t = toNumber(selectedLatest.ts);
    return t != null ? Math.round(t) : null;
  }, [selectedLatest]);

  useEffect(() => {
    const now = Date.now();
    const last = lastUpdateRef.current;
    lastUpdateRef.current = now;

    const rainFactorCurrent = clamp01(rainMmHrCurrent / RAIN_FULL_MMHR);

    if (last == null) {
      setRainMemory(rainFactorCurrent);
      return;
    }

    const dtMin = (now - last) / 60000;
    const decay = Math.exp(-dtMin / TAU_MIN);
    setRainMemory((prev) => Math.max(rainFactorCurrent, prev * decay));
  }, [rainMmHrCurrent]);

  const scenarioMetrics = useMemo(() => {
    if (forecastHorizon === "now") {
      return {
        rainMmHr: rainMmHrCurrent,
        floodDepthCm: floodDepthCmCurrent,
      };
    }

    const hours = forecastHours(forecastHorizon);
    const projectedRainMm = rainMmHrCurrent * hours;
    const projectedDepth = Math.max(
      floodDepthCmCurrent,
      floodDepthCmCurrent + projectedRainMm * 0.35
    );

    return {
      rainMmHr: rainMmHrCurrent,
      floodDepthCm: projectedDepth,
    };
  }, [forecastHorizon, rainMmHrCurrent, floodDepthCmCurrent]);

  const rainFactor = useMemo(
    () => clamp01(scenarioMetrics.rainMmHr / RAIN_FULL_MMHR),
    [scenarioMetrics.rainMmHr]
  );

  const depthFactor = useMemo(
    () => clamp01(scenarioMetrics.floodDepthCm / DEPTH_FULL_CM),
    [scenarioMetrics.floodDepthCm]
  );

  const effectiveDepthFactor = useMemo(() => {
    const gate = DEPTH_DAMP_BASE + (1 - DEPTH_DAMP_BASE) * rainMemory;
    return depthFactor * gate;
  }, [depthFactor, rainMemory]);

  const dynamicRisk = useMemo(() => {
    return 1.0 * (0.4 * rainFactor + 0.6 * effectiveDepthFactor);
  }, [rainFactor, effectiveDepthFactor]);

  const riskColor = useMemo(() => getRiskColor(dynamicRisk), [dynamicRisk]);

  const zoneStyle = useMemo(() => {
    return {
      color: riskColor,
      weight: 4,
      opacity: 0.95,
      fillColor: riskColor,
      fillOpacity: forecastHorizon === "now" ? 0.12 : 0.18,
    };
  }, [riskColor, forecastHorizon]);

  const onEachZoneFeature = (_feature: ZoneFeature, layer: Layer) => {
    layer.on("click", (e: LeafletMouseEvent) => {
      if (!selectedDevice) return;

      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;

      const a = turfPoint([selectedDevice.lng, selectedDevice.lat]);
      const b = turfPoint([clickLng, clickLat]);
      const km = distance(a, b, { units: "kilometers" });
      const distMeters = km * 1000;

      const html = `
        <div style="min-width:260px">
          <div style="font-weight:700">Flood zone overview</div>
          <div style="margin-top:6px">
            <div><b>Selected sensor</b>: ${selectedDevice.name}</div>
            <div><b>Scenario</b>: ${forecastHorizon === "now" ? "Now" : `+${forecastHorizon}`}</div>
            <div><b>Distance (clicked → sensor)</b>: ${distMeters.toFixed(1)} m</div>
          </div>
          <hr style="margin:10px 0"/>
          <div style="color:#444">
            Raster tiles show susceptibility/hillshade. Colored vector fill reflects current/projected scenario severity.
          </div>
        </div>
      `;
      layer.bindPopup(html).openPopup(e.latlng);
    });
  };

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-[1001]">
        <button
          type="button"
          onClick={() => setHudOpen((v) => !v)}
          className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-bold text-zinc-800 shadow ring-1 ring-zinc-200"
        >
          {hudOpen ? "Hide Info" : "Show Info"}
        </button>
      </div>

      {hudOpen && (
        <div
          className={`absolute z-[1000] rounded-xl bg-white/95 px-4 py-3 shadow ring-1 ring-zinc-200 ${
            isMobile ? "left-3 right-3 top-14 max-w-none" : "right-3 top-14 max-w-[280px]"
          }`}
        >
          <div className="text-xs font-semibold text-zinc-500">
            {forecastHorizon === "now"
              ? "Selected Sensor — Live"
              : `Selected Sensor — Forecast ${forecastHorizon}`}
          </div>

          <div className="mt-1 text-sm font-bold text-zinc-900">
            {selectedDevice?.name ?? "—"} • Risk: {dynamicRisk.toFixed(3)} ({riskColor})
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Rain: <span className="font-semibold">{fmt(scenarioMetrics.rainMmHr, 1)}</span> mm/hr
          </div>

          <div className="text-xs text-zinc-700">
            Flood depth: <span className="font-semibold">{fmt(scenarioMetrics.floodDepthCm, 1)}</span> cm
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            RainMem: {rainMemory.toFixed(3)} • EffDepth: {effectiveDepthFactor.toFixed(3)}
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            Updated: {fmtTime(tsMs)}
          </div>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={15}
        minZoom={14}
        maxZoom={18}
        scrollWheelZoom
        maxBounds={BATANGAS_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{
          height: isMobile ? "68vh" : "80vh",
          width: "100%",
          borderRadius: "8px",
        }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        <TileLayer
          url="/tiles/hillshade/{z}/{x}/{y}.jpg"
          opacity={0.45}
          zIndex={200}
        />

        <TileLayer
          url="/tiles/susceptibility/{z}/{x}/{y}.jpg"
          opacity={0.65}
          zIndex={300}
        />

        {zoneGeoJson && (
          <GeoJSON
            key={`zone-${riskColor}-${forecastHorizon}-${selectedDeviceId}`}
            data={zoneGeoJson}
            style={() => zoneStyle}
            onEachFeature={onEachZoneFeature}
          />
        )}

        {userPosition && (
          <CircleMarker
            center={[userPosition.lat, userPosition.lng]}
            radius={8}
            pathOptions={{
              color: "#1d4ed8",
              fillColor: "#3b82f6",
              fillOpacity: 0.9,
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

          const deviceRain =
            (toNumber(deviceLatest?.rainRateMmHr300) ??
              toNumber(deviceLatest?.rain_rate_mmh_300) ??
              toNumber(deviceLatest?.rainRateMmHr60) ??
              toNumber(deviceLatest?.rain_rate_mmh_60) ??
              0);

          const deviceDepth =
            (toNumber(deviceLatest?.floodDepthCm) ??
              toNumber(deviceLatest?.flood_depth_cm) ??
              0);

          const deviceTs = (() => {
            const t = toNumber(deviceLatest?.ts);
            return t != null ? Math.round(t) : null;
          })();

          const scenarioDeviceMetrics =
            forecastHorizon === "now"
              ? {
                  rainMmHr: deviceRain,
                  floodDepthCm: deviceDepth,
                }
              : (() => {
                  const hours = forecastHours(forecastHorizon);
                  const projectedRainMm = deviceRain * hours;
                  const projectedDepth = Math.max(deviceDepth, deviceDepth + projectedRainMm * 0.35);
                  return {
                    rainMmHr: deviceRain,
                    floodDepthCm: projectedDepth,
                  };
                })();

          return (
            <Marker
              key={device.id}
              position={[device.lat, device.lng]}
              icon={isSelected ? selectedSensorIcon : sensorIcon}
              eventHandlers={{
                click: () => onSelectDevice(device.id),
              }}
            >
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
                        <b>Rain</b>: {fmt(scenarioDeviceMetrics.rainMmHr, 1)} mm/hr
                      </div>
                      <div>
                        <b>Flood depth</b>: {fmt(scenarioDeviceMetrics.floodDepthCm, 1)} cm
                      </div>
                      <div>
                        <b>Updated</b>: {fmtTime(deviceTs)}
                      </div>
                    </>
                  ) : (
                    <div style={{ color: "#666" }}>
                      No recent telemetry for this sensor.
                    </div>
                  )}

                  {!isSelected && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => onSelectDevice(device.id)}
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
