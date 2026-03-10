"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, Layer, LeafletMouseEvent } from "leaflet";
import type {
  FeatureCollection,
  Point,
  Feature,
  Polygon,
  MultiPolygon,
  GeoJsonProperties,
} from "geojson";
import { point as turfPoint } from "@turf/helpers";
import distance from "@turf/distance";
import "leaflet/dist/leaflet.css";

type FloodMapProps = {
  // still passed from dashboard (unused for now)
  geoJsonData: FeatureCollection<Point, { z: number }>;
};

type LatestReading = {
  ts?: number;

  floodDepthCm?: number | null;
  flood_depth_cm?: number | null;

  rainRateMmHr60?: number | null;
  rain_rate_mmh_60?: number | null;
};

type ApiDataPayload = {
  latest: LatestReading | null;
  recent: LatestReading[];
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

// Leaflet marker icon fix
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

export default function FixedFloodMapInner({ geoJsonData }: FloodMapProps) {
  void geoJsonData;

  // Sensor coordinate
  const SENSOR_LAT = 13.735412678211276;
  const SENSOR_LNG = 121.07296804092847;

  const sensorLatLng: LatLngExpression = [SENSOR_LAT, SENSOR_LNG];
  const center: LatLngExpression = sensorLatLng;

  const [zoneGeoJson, setZoneGeoJson] = useState<ZoneFC | null>(null);
  const [latest, setLatest] = useState<LatestReading | null>(null);

  // Rain persistence memory (0..1)
  const [rainMemory, setRainMemory] = useState(0);
  const lastUpdateRef = useRef<number | null>(null);

  // Calibrations
  const RAIN_FULL_MMHR = 50;
  const DEPTH_FULL_CM = 30;
  const TAU_MIN = 60;
  const DEPTH_DAMP_BASE = 0.2;

  // Load zone GeoJSON
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

  // Poll latest sensor
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

  const floodDepthCm = useMemo(() => {
    if (!latest) return 0;
    return toNumber(latest.floodDepthCm) ?? toNumber(latest.flood_depth_cm) ?? 0;
  }, [latest]);

  const rainMmHr = useMemo(() => {
    if (!latest) return 0;
    return toNumber(latest.rainRateMmHr60) ?? toNumber(latest.rain_rate_mmh_60) ?? 0;
  }, [latest]);

  const tsMs = useMemo(() => {
    if (!latest) return null;
    const t = toNumber(latest.ts);
    return t != null ? Math.round(t) : null;
  }, [latest]);

  const rainFactor = useMemo(() => clamp01(rainMmHr / RAIN_FULL_MMHR), [rainMmHr]);
  const depthFactor = useMemo(() => clamp01(floodDepthCm / DEPTH_FULL_CM), [floodDepthCm]);

  useEffect(() => {
    const now = Date.now();
    const last = lastUpdateRef.current;
    lastUpdateRef.current = now;

    if (last == null) {
      setRainMemory(rainFactor);
      return;
    }

    const dtMin = (now - last) / 60000;
    const decay = Math.exp(-dtMin / TAU_MIN);
    setRainMemory((prev) => Math.max(rainFactor, prev * decay));
  }, [rainFactor]);

  const effectiveDepthFactor = useMemo(() => {
    const gate = DEPTH_DAMP_BASE + (1 - DEPTH_DAMP_BASE) * rainMemory;
    return depthFactor * gate;
  }, [depthFactor, rainMemory]);

  const dynamicRisk = useMemo(() => {
    return 1.0 * (0.4 * rainFactor + 0.6 * effectiveDepthFactor);
  }, [rainFactor, effectiveDepthFactor]);

  const riskColor = useMemo(() => getRiskColor(dynamicRisk), [dynamicRisk]);

  /**
   * IMPORTANT VISIBILITY CHANGE:
   * Your dissolved polygon covers a huge area. If we fill it strongly,
   * it hides the raster tiles. So we make it mostly an outline.
   */
  const zoneStyle = useMemo(() => {
    return {
      color: riskColor,
      weight: 4,
      opacity: 0.95,

      fillColor: riskColor,
      fillOpacity: 0.12, // <- very low, so susceptibility tiles are visible
    };
  }, [riskColor]);

  // Polygon popup: distance from clicked point to sensor
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
            <div><b>Base susceptibility</b>: 1.0</div>
            <div><b>Distance (clicked → sensor)</b>: ${distMeters.toFixed(1)} m</div>
          </div>
          <hr style="margin:10px 0"/>
          <div style="color:#444">
            Raster tiles show susceptibility/hillshade. Vector polygon shows live risk outline.
          </div>
        </div>
      `;
      layer.bindPopup(html).openPopup(e.latlng);
    });
  };

  return (
    <div className="relative">
      {/* HUD */}
      <div className="absolute right-3 top-3 z-[1000] rounded-xl bg-white/95 px-4 py-3 shadow ring-1 ring-zinc-200">
        <div className="text-xs font-semibold text-zinc-500">Sensor Live</div>
        <div className="mt-1 text-sm font-bold text-zinc-900">
          Risk: {dynamicRisk.toFixed(3)} ({riskColor})
        </div>
        <div className="mt-2 text-xs text-zinc-700">
          Rain: <span className="font-semibold">{fmt(rainMmHr, 1)}</span> mm/hr
        </div>
        <div className="text-xs text-zinc-700">
          Flood depth: <span className="font-semibold">{fmt(floodDepthCm, 1)}</span> cm
        </div>
        <div className="mt-2 text-xs text-zinc-700">
          RainMem: {rainMemory.toFixed(3)} • EffDepth: {effectiveDepthFactor.toFixed(3)}
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">
          Updated: {fmtTime(tsMs)}
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom
        style={{ height: "80vh", width: "100%", borderRadius: "8px" }}
      >
        {/* Base map */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Hillshade tiles (your files are .jpg) */}
        <TileLayer
          url="/tiles/hillshade/{z}/{x}/{y}.jpg"
          opacity={0.45}
          zIndex={200}
        />

        {/* Susceptibility tiles (your files are .jpg) */}
        <TileLayer
          url="/tiles/susceptibility/{z}/{x}/{y}.jpg"
          opacity={0.65}
          zIndex={300}
        />

        {/* Vector zone outline on top */}
        {zoneGeoJson && (
          <GeoJSON
            key={`zone-${riskColor}`}
            data={zoneGeoJson}
            style={() => zoneStyle}
            onEachFeature={onEachZoneFeature}
          />
        )}

        {/* Sensor marker */}
        <Marker position={sensorLatLng}>
          <Popup>
            <div style={{ minWidth: 240 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Sensor: esp32-1</div>
              <div><b>Status</b>: {riskColor.toUpperCase()}</div>
              <div><b>Dynamic Risk</b>: {dynamicRisk.toFixed(3)}</div>
              <hr style={{ margin: "10px 0" }} />
              <div><b>Rain</b>: {fmt(rainMmHr, 1)} mm/hr</div>
              <div><b>Flood depth</b>: {fmt(floodDepthCm, 1)} cm</div>
              <div><b>Rain memory</b>: {rainMemory.toFixed(3)}</div>
              <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                Updated: {fmtTime(tsMs)}
              </div>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}