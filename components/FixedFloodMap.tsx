"use client";

import dynamic from "next/dynamic";
import type { FeatureCollection, Point } from "geojson";

export type SensorDevice = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoneLabel: string;
};

export type ForecastHorizon = "now" | "2h" | "4h" | "6h" | "8h";

export type FloodMapProps = {
  geoJsonData: FeatureCollection<Point, { z: number }>;
  devices: SensorDevice[];
  selectedDeviceId: string;
  userPosition: { lat: number; lng: number } | null;
  forecastHorizon: ForecastHorizon;
  onSelectDevice: (deviceId: string) => void;
};

const FixedFloodMapInner = dynamic(() => import("@/components/FixedFloodMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[80vh] w-full items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">
      Loading map…
    </div>
  ),
});

export default function FixedFloodMap(props: FloodMapProps) {
  return <FixedFloodMapInner {...props} />;
}
