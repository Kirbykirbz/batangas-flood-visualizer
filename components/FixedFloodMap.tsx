// components/FixedFloodMap.tsx
"use client";

import "leaflet/dist/leaflet.css";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLngExpression, Layer, LeafletMouseEvent } from "leaflet";
import type {
  FeatureCollection,
  Feature,
  Polygon,
  MultiPolygon,
  GeoJsonProperties,
} from "geojson";
import { point as turfPoint } from "@turf/helpers";
import distance from "@turf/distance";

// =====================
// Dynamic imports (NO SSR)
// =====================
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const GeoJSON = dynamic(
  () => import("react-leaflet").then((m) => m.GeoJSON),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);

const BATANGAS_BOUNDS: [[number, number], [number, number]] = [
  [13.63, 121.00], // Southwest (lat, lng)
  [13.83, 121.15], // Northeast (lat, lng)
];

// =====================
// Types
// =====================

type FloodMapProps = {
  // kept for compatibility with dashboard/page.tsx; not used anymore
  geoJsonData: FeatureCollection<any, any>;
};

type LatestReading = {
  ts?: number;

  // computed on server
  floodDepthCm?: number | null;
  flood_depth_cm?: number | null;

  // rain
  tips60?: number | null;
  tips_60?: number | null;

  rainRateMmHr60?: number | null;
  rain_rate_mmh_60?: number | null;

  rainRateMmHr300?: number | null;
  rain_rate_mmh_300?: number | null;

  // quality flags
  usValid?: boolean | null;
  us_valid?: boolean | null;

  rssiDbm?: number | null;
  rssi_dbm?: number | null;

  // calibration debug
  dryDistanceCm?: number | null;
  dry_distance_cm?: number | null;

  rawDistCm?: number | null;
  raw_dist_cm?: number | null;
};

type ApiDataPayload = {
  latest: LatestReading | null;
  recent: LatestReading[];
  serverTime: number;
};

type ZoneFeature = Feature<Polygon | MultiPolygon, GeoJsonProperties>;
type ZoneFC = FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>;

// =====================
// Helpers
// =====================

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

function getRiskColor(risk: number) {
  if (risk <= 0.3) return "green";
  if (risk <= 0.6) return "orange";
  return "red";
}

type SimMode = "auto" | "forceDry" | "forceActive";

export default function FixedFloodMap({ geoJsonData }: FloodMapProps) {
  void geoJsonData;

  // Sensor coordinate
  const SENSOR_LAT = 13.735412678211276;
  const SENSOR_LNG = 121.07296804092847;

  const sensorLatLng: LatLngExpression = [SENSOR_LAT, SENSOR_LNG];
  const center: LatLngExpression = sensorLatLng;

  // QGIS sampled susceptibility at sensor (class 3 => 1.0)
  const BASE_SUSC_AT_SENSOR = 1.0;

  // Model constants (match your context)
  const RAIN_FULL_MMHR = 50;
  const DEPTH_FULL_CM = 30;
  const TAU_MIN = 60;
  const DEPTH_DAMP_BASE = 0.2;

  // Activation threshold
  const DEPTH_ON_CM = 5;

  // Stale threshold (if no recent telemetry, treat as offline)
  const STALE_MS = 15_000;

  // State
  const [zoneGeoJson, setZoneGeoJson] = useState<ZoneFC | null>(null);
  const [latest, setLatest] = useState<LatestReading | null>(null);

  const [rainMemory, setRainMemory] = useState(0);
  const lastUpdateRef = useRef<number | null>(null);

  // Simulation
  const [mode, setMode] = useState<SimMode>("auto");

  // HUD behavior: show only when sensor clicked
  const [hudOpen, setHudOpen] = useState(false);

  // Client-only Leaflet icon fix (prevents window errors on SSR)
  useEffect(() => {
    let cancelled = false;

    async function fixLeafletIcon() {
      // Only run in browser
      if (typeof window === "undefined") return;

      const L = (await import("leaflet")).default;
      if (cancelled) return;

      const defaultIcon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L.Marker.prototype.options as any).icon = defaultIcon;
    }

    fixLeafletIcon();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Load polygon zone
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

  // ---- Poll latest sensor
  useEffect(() => {
    let cancelled = false;

    async function loadLatest() {
      try {
        const res = await fetch(`/api/data?limit=1&t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ApiDataPayload;
        if (!cancelled) setLatest(json.latest ?? null);
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

  // ---- Extract timestamp
  const tsMs = useMemo(() => {
    if (!latest) return null;
    const t = toNumber(latest.ts);
    return t != null ? Math.round(t) : null;
  }, [latest]);

  // ---- Freshness
  const isStale = useMemo(() => {
    if (!tsMs) return true;
    return Date.now() - tsMs > STALE_MS;
  }, [tsMs]);

  // ---- Extract rain + tips
  const tips60 = useMemo(() => {
    if (!latest) return 0;
    return (
      toNumber(latest.tips60) ??
      toNumber(latest.tips_60) ??
      0
    );
  }, [latest]);

  const rainMmHr60 = useMemo(() => {
    if (!latest) return 0;
    return (
      toNumber(latest.rainRateMmHr60) ??
      toNumber(latest.rain_rate_mmh_60) ??
      0
    );
  }, [latest]);

  const rainMmHr300 = useMemo(() => {
    if (!latest) return 0;
    return (
      toNumber(latest.rainRateMmHr300) ??
      toNumber(latest.rain_rate_mmh_300) ??
      0
    );
  }, [latest]);

  // ---- Flood depth (server derived, already gated in ingest)
  const floodDepthCm = useMemo(() => {
    if (!latest) return 0;
    return (
      toNumber(latest.floodDepthCm) ??
      toNumber(latest.flood_depth_cm) ??
      0
    );
  }, [latest]);

  // ---- usValid
  const usValid = useMemo(() => {
    if (!latest) return null;
    return toBool(latest.usValid) ?? toBool(latest.us_valid) ?? null;
  }, [latest]);

  // ---- Activation: auto uses real reading; forced modes are simulation-only
  const autoActive = useMemo(() => {
    if (!latest || isStale) return false;
    const rainingNow = tips60 > 0;
    const floodedNow = floodDepthCm >= DEPTH_ON_CM;
    return rainingNow || floodedNow;
  }, [latest, isStale, tips60, floodDepthCm]);

  const active = useMemo(() => {
    if (mode === "forceDry") return false;
    if (mode === "forceActive") return true;
    return autoActive;
  }, [mode, autoActive]);

  // ---- Factors (when inactive, keep risk neutral)
  const rainFactor = useMemo(() => {
    if (!active) return 0;
    // Prefer 5-min for stability if nonzero; fallback to 1-min
    const rate = rainMmHr300 > 0 ? rainMmHr300 : rainMmHr60;
    return clamp01(rate / RAIN_FULL_MMHR);
  }, [active, rainMmHr60, rainMmHr300]);

  const depthFactor = useMemo(() => {
    if (!active) return 0;
    return clamp01(floodDepthCm / DEPTH_FULL_CM);
  }, [active, floodDepthCm]);

  // ---- Rain memory decay (only when active in auto; forced active still uses it for realism)
  useEffect(() => {
    const now = Date.now();
    const last = lastUpdateRef.current;
    lastUpdateRef.current = now;

    if (!active) {
      setRainMemory(0);
      return;
    }

    if (last == null) {
      setRainMemory(rainFactor);
      return;
    }

    const dtMin = (now - last) / 60000;
    const decay = Math.exp(-dtMin / TAU_MIN);
    setRainMemory((prev) => Math.max(rainFactor, prev * decay));
  }, [rainFactor, active]);

  // ---- Depth gate (tampering control)
  const effectiveDepthFactor = useMemo(() => {
    if (!active) return 0;
    const gate = DEPTH_DAMP_BASE + (1 - DEPTH_DAMP_BASE) * rainMemory; // 0.2..1.0
    return depthFactor * gate;
  }, [active, depthFactor, rainMemory]);

  // ---- Risk
  const dynamicRisk = useMemo(() => {
    if (!active) return 0;
    const raw = 0.4 * rainFactor + 0.6 * effectiveDepthFactor;
    return BASE_SUSC_AT_SENSOR * raw;
  }, [active, rainFactor, effectiveDepthFactor, BASE_SUSC_AT_SENSOR]);

  const dynamicRiskClamped = useMemo(() => clamp01(dynamicRisk), [dynamicRisk]);

  const riskColor = useMemo(() => {
    if (!active) return "gray";
    return getRiskColor(dynamicRiskClamped);
  }, [active, dynamicRiskClamped]);

  // Zone style (keep fill low so raster stays visible)
  const zoneStyle = useMemo(() => {
    if (!active) {
      return {
        color: "#666",
        weight: 3,
        opacity: 0.5,
        fillColor: "#999",
        fillOpacity: 0.05,
      };
    }

    return {
      color: riskColor,
      weight: 4,
      opacity: 0.95,
      fillColor: riskColor,
      fillOpacity: 0.12,
    };
  }, [riskColor, active]);

  // ---- Polygon popup: distance clicked -> sensor
  const onEachZoneFeature = (_feature: ZoneFeature, layer: Layer) => {
    layer.on("click", (e: LeafletMouseEvent) => {
      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;

      const a = turfPoint([SENSOR_LNG, SENSOR_LAT]);
      const b = turfPoint([clickLng, clickLat]);
      const km = distance(a, b, { units: "kilometers" });
      const distMeters = km * 1000;

      const html = `
        <div style="min-width:260px">
          <div style="font-weight:700">High susceptibility zone (dissolved)</div>
          <div style="margin-top:6px">
            <div><b>Base susceptibility (sensor)</b>: ${BASE_SUSC_AT_SENSOR.toFixed(1)}</div>
            <div><b>Distance (clicked → sensor)</b>: ${distMeters.toFixed(1)} m</div>
          </div>
          <hr style="margin:10px 0"/>
          <div style="color:#444">
            Mode: <b>${mode}</b> • Active: <b>${active ? "YES" : "NO"}</b>
          </div>
        </div>
      `;
      
      layer.bindPopup(html).openPopup(e.latlng);
    });
  };

  // Toggle tile visibility
  const showSusceptibilityTiles = active;
  const showHud = hudOpen;

  return (
    <div className="relative">
      {/* Simulation control (top-left) */}
      <div className="absolute left-3 top-5 z-[1000] flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow ring-1 ring-zinc-200">
        <div className="text-xs font-semibold text-zinc-700">Mode</div>
        <select
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-900"
          value={mode}
          onChange={(e) => setMode(e.target.value as SimMode)}
        >
          <option value="auto">auto</option>
          <option value="forceDry">forceDry</option>
          <option value="forceActive">forceActive</option>
        </select>

        <div className="ml-2 text-[11px] text-zinc-500">
          {isStale ? "STALE" : "LIVE"} • {active ? "ACTIVE" : "CALM"}
        </div>
      </div>

      {/* HUD overlay (only when marker clicked) */}
      {showHud && (
        <div className="absolute right-3 top-3 z-[1000] w-[320px] rounded-xl bg-white/95 px-4 py-3 shadow ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-zinc-500">Sensor Live</div>
              <div className="mt-1 text-sm font-bold text-zinc-900">
                Risk: {dynamicRiskClamped.toFixed(3)} ({riskColor})
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
              onClick={() => setHudOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Terrain susceptibility:{" "}
            <span className="font-semibold">{BASE_SUSC_AT_SENSOR.toFixed(1)} (class 3)</span>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Active: <span className="font-semibold">{active ? "YES" : "NO"}</span>{" "}
            <span className="text-zinc-500">({mode})</span>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Rain (1m): <span className="font-semibold">{fmt(rainMmHr60, 1)}</span> mm/hr • Tips60:{" "}
            <span className="font-semibold">{fmt(tips60, 0)}</span>
          </div>

          <div className="text-xs text-zinc-700">
            Rain (5m): <span className="font-semibold">{fmt(rainMmHr300, 1)}</span> mm/hr
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            Flood depth: <span className="font-semibold">{fmt(floodDepthCm, 1)}</span> cm • usValid:{" "}
            <span className="font-semibold">
              {usValid == null ? "—" : usValid ? "true" : "false"}
            </span>
          </div>

          <div className="mt-2 text-xs text-zinc-700">
            RainMem: {rainMemory.toFixed(3)} • EffDepth: {effectiveDepthFactor.toFixed(3)}
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">Updated: {fmtTime(tsMs)}</div>
        </div>
      )}

      <MapContainer
  center={center}
  zoom={18}
  minZoom={14}
  maxZoom={18}
  scrollWheelZoom
  zoomControl={false}
  maxBounds={BATANGAS_BOUNDS}
  maxBoundsViscosity={1.0}
  style={{ height: "80vh", width: "100%", borderRadius: "8px" }}
>
        {/* Base OSM */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Hillshade (always visible, mild) */}
        <TileLayer url="/tiles/hillshade/{z}/{x}/{y}.jpg" opacity={0.45} />

        {/* Susceptibility tiles (only when active) */}
        {showSusceptibilityTiles && (
          <TileLayer url="/tiles/susceptibility/{z}/{x}/{y}.png" opacity={0.65} />
        )}

        {/* Flood zone polygon */}
        {zoneGeoJson && (
          <GeoJSON
            key={`zone-${mode}-${active ? "on" : "off"}-${riskColor}`}
            data={zoneGeoJson}
            style={() => zoneStyle}
            onEachFeature={onEachZoneFeature}
          />
        )}

        {/* Sensor marker */}
        <Marker
          position={sensorLatLng}
          eventHandlers={{
            click: () => setHudOpen(true),
          }}
        >
          <Popup>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Sensor: esp32-1</div>

              <div>
                <b>Freshness</b>: {isStale ? "STALE" : "LIVE"}
              </div>
              <div>
                <b>Mode</b>: {mode}
              </div>
              <div>
                <b>Active</b>: {active ? "YES" : "NO"}
              </div>

              <hr style={{ margin: "10px 0" }} />

              <div>
                <b>Risk</b>: {dynamicRiskClamped.toFixed(3)} ({riskColor})
              </div>
              <div>
                <b>Rain (1m)</b>: {fmt(rainMmHr60, 1)} mm/hr • <b>Tips60</b>: {fmt(tips60, 0)}
              </div>
              <div>
                <b>Rain (5m)</b>: {fmt(rainMmHr300, 1)} mm/hr
              </div>
              <div>
                <b>Flood depth</b>: {fmt(floodDepthCm, 1)} cm
              </div>
              <div>
                <b>usValid</b>: {usValid == null ? "—" : usValid ? "true" : "false"}
              </div>

              <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                Updated: {fmtTime(tsMs)}
              </div>

              <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                Tip: click marker to open HUD.
              </div>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}