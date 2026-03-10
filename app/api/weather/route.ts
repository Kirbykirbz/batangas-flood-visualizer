// app/api/weather/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WeatherPayload = {
  fetchedAt: number;
  lat: number;
  lng: number;
  timezone: string;
  current: {
    time: string | null;
    precipitation_mm: number | null; // Open-Meteo "precipitation" (mm)
    rain_mm: number | null; // Open-Meteo "rain" (mm)
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

type CacheEntry = { ts: number; data: WeatherPayload };

const g = globalThis as unknown as { __wxCache?: Map<string, CacheEntry> };
if (!g.__wxCache) g.__wxCache = new Map();
const wxCache = g.__wxCache;

const CACHE_MS = 60_000; // 1 minute cache

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function numArr(v: unknown): number[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
    : [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const body: WeatherApiResponse = { ok: false, error: "lat/lng required" };
    return NextResponse.json(body, { status: 400 });
  }

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const now = Date.now();

  const cached = wxCache.get(key);
  if (cached && now - cached.ts < CACHE_MS) {
    const body: WeatherApiResponse = { ok: true, source: "cache", data: cached.data };
    return NextResponse.json(body);
  }

  const timezone = "Asia/Manila";

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lng)}` +
    `&current=precipitation,rain` +
    `&hourly=precipitation,rain,precipitation_probability` +
    `&forecast_days=2` +
    `&timezone=${encodeURIComponent(timezone)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    const body: WeatherApiResponse = {
      ok: false,
      error: `weather upstream ${res.status}`,
      detail: text,
    };
    return NextResponse.json(body, { status: 502 });
  }

  const raw = (await res.json()) as Record<string, unknown>;

  const current = (raw.current ?? {}) as Record<string, unknown>;
  const hourly = (raw.hourly ?? {}) as Record<string, unknown>;

  const payload: WeatherPayload = {
    fetchedAt: now,
    lat,
    lng,
    timezone,
    current: {
      time: typeof current.time === "string" ? current.time : null,
      precipitation_mm: num(current.precipitation),
      rain_mm: num(current.rain),
    },
    hourly: {
      time: strArr(hourly.time),
      precipitation_mm: numArr(hourly.precipitation),
      rain_mm: numArr(hourly.rain),
      precip_prob: numArr(hourly.precipitation_probability),
    },
  };

  wxCache.set(key, { ts: now, data: payload });

  const body: WeatherApiResponse = { ok: true, source: "live", data: payload };
  return NextResponse.json(body);
}