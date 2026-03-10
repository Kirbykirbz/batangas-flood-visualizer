// app/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { FeatureCollection, Feature, Point } from "geojson";
import FixedFloodMap from "@/components/FixedFloodMap";

// ✅ If you already created WeatherCard, uncomment these two lines
import WeatherCard from "@/components/WeatherCard";
const WX_LAT = 13.735412678211276;
const WX_LNG = 121.07296804092847;

export default function DashboardPage() {
  // FixedFloodMap keeps geoJsonData prop only for compatibility
  const emptyPoints = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: [] as Array<Feature<Point, { z: number }>>,
      }) satisfies FeatureCollection<Point, { z: number }>,
    []
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Flood Pathway Visualizer
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Batangas — Live Map
            </h1>
            <div className="mt-2 text-sm text-zinc-600">
              Terrain susceptibility × live sensor hazard (rain + flood depth) with simulation-ready activation.
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

        {/* ✅ Weather (optional) */}
        {/*
        <div className="mt-4">
          <WeatherCard lat={WX_LAT} lng={WX_LNG} />
        </div>
        */}

        {/* Map */}
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
          <FixedFloodMap geoJsonData={emptyPoints} />
        </div>

        {/* Notes */}
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 shadow-sm">
          <div className="font-extrabold text-zinc-900">Activation behavior</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <span className="font-semibold">Auto:</span> visuals activate when{" "}
              <span className="font-semibold">tips60 &gt; 0</span> (raining) OR when{" "}
              <span className="font-semibold">floodDepthCm ≥ threshold</span> (post-rain flooding).
            </li>
            <li>
              <span className="font-semibold">Force Dry / Force Active:</span> visual-only overrides for testing; risk
              color still comes from readings.
            </li>
            <li>
              <span className="font-semibold">Stale handling:</span> if sensor data is old, Auto disables activation.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}