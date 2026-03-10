"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type WeatherCardProps = {
  lat: number;
  lng: number;
  title?: string;
  pollMs?: number; // default 60s
};

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function sumFirst(arr: number[], n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) s += Number(arr[i] ?? 0);
  return s;
}

export default function WeatherCard({
  lat,
  lng,
  title = "Weather (Open-Meteo)",
  pollMs = 60_000,
}: WeatherCardProps) {
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const inFlightRef = useRef(false);

  async function loadWeather() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}&t=${Date.now()}`, {
        cache: "no-store",
      });

      const json = (await res.json()) as WeatherApiResponse;

      if (!json.ok) {
        setWeather(null);
        setError(json.detail ? `${json.error}: ${json.detail}` : json.error);
        return;
      }

      setWeather(json.data);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setWeather(null);
      setError(msg);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    loadWeather();
    const id = window.setInterval(loadWeather, pollMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, pollMs]);

  const next1hMm = useMemo(() => {
    if (!weather) return null;
    const v = weather.hourly.precipitation_mm?.[0];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }, [weather]);

  const next3hMm = useMemo(() => {
    if (!weather) return null;
    const arr = weather.hourly.precipitation_mm ?? [];
    if (!Array.isArray(arr) || arr.length < 3) return null;
    return sumFirst(arr, 3);
  }, [weather]);

  const next1hProb = useMemo(() => {
    if (!weather) return null;
    const v = weather.hourly.precip_prob?.[0];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }, [weather]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-base font-extrabold text-zinc-900">{title}</div>
          <div className="mt-1 text-xs text-zinc-500">
            Location: {lat.toFixed(5)}, {lng.toFixed(5)}
            {weather?.timezone ? ` • Timezone: ${weather.timezone}` : ""}
          </div>
        </div>

        <button
          className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-zinc-50"
          onClick={loadWeather}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="mt-3 text-sm text-zinc-600">Loading weather…</div>
      ) : error ? (
        <div className="mt-3 text-sm text-red-700">{error}</div>
      ) : !weather ? (
        <div className="mt-3 text-sm text-zinc-600">No weather data.</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">Current precipitation</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                {weather.current.precipitation_mm == null ? "—" : `${fmt(weather.current.precipitation_mm, 1)} mm`}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Updated: {new Date(weather.fetchedAt).toLocaleString()}
              </div>
            </div>

            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">Next 1 hour</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                {next1hMm == null ? "—" : `${fmt(next1hMm, 1)} mm`}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Probability: {next1hProb == null ? "—" : `${Math.round(next1hProb)}%`}
              </div>
            </div>

            <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">Next 3 hours (sum)</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                {next3hMm == null ? "—" : `${fmt(next3hMm, 1)} mm`}
              </div>
              <div className="mt-1 text-xs text-zinc-500">Useful for forecast-based activation.</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-zinc-500">
            Note: This is forecast/nowcast data. Your tipping-bucket + ultrasonic remain the ground truth for local hazard
            activation.
          </div>
        </>
      )}
    </div>
  );
}