"use client";

import { useEffect, useMemo, useState } from "react";

type ForecastWeatherCondition = {
  place?: string;
  weather_condition?: string;
  caused_by?: string;
  impacts?: string;
};

type ForecastWindCondition = {
  place?: string;
  speed?: string;
  direction?: string;
  coastal_water?: string;
};

type TemperatureHumidityEntry = {
  max?: { value?: string; time?: string };
  min?: { value?: string; time?: string };
};

type TidalPrediction = {
  type?: string;
  value?: string;
  time?: string;
};

type PagasaForecast = {
  issued_at?: string;
  synopsis?: string;
  forecast_weather_conditions?: ForecastWeatherCondition[];
  forecast_wind_conditions?: ForecastWindCondition[];
  temperature_humidity?: Record<string, TemperatureHumidityEntry>;
  astronomical_information?: Record<string, string>;
  tidal_predictions?: TidalPrediction[];
};

type Props = {
  selectedSensorName?: string | null;
  zoneLabel?: string | null;
  currentRainMmHr?: number | null;
  currentFloodDepthCm?: number | null;
  overflow?: boolean;
};

type UpstreamResponse =
  | {
      ok: true;
      forecast: PagasaForecast;
      fetchedAt?: string;
      cached?: boolean;
    }
  | {
      ok: false;
      error?: string;
      details?: string;
    };

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function cleanText(value: string | undefined | null) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findBestWeatherRow(
  rows: ForecastWeatherCondition[] | undefined
): ForecastWeatherCondition | null {
  if (!rows || rows.length === 0) return null;

  const priority = rows.find((row) => {
    const place = cleanText(row.place).toLowerCase();
    return (
      place.includes("metro manila") ||
      place.includes("ncr") ||
      place.includes("calabarzon") ||
      place.includes("southern luzon") ||
      place.includes("luzon")
    );
  });

  return priority ?? rows[0] ?? null;
}

function findBestWindRow(
  rows: ForecastWindCondition[] | undefined
): ForecastWindCondition | null {
  if (!rows || rows.length === 0) return null;

  const priority = rows.find((row) => {
    const place = cleanText(row.place).toLowerCase();
    return (
      place.includes("metro manila") ||
      place.includes("ncr") ||
      place.includes("calabarzon") ||
      place.includes("southern luzon") ||
      place.includes("luzon")
    );
  });

  return priority ?? rows[0] ?? null;
}

function findBestTemperatureEntry(
  map: Record<string, TemperatureHumidityEntry> | undefined
): { label: string; entry: TemperatureHumidityEntry } | null {
  if (!map) return null;

  const keys = Object.keys(map);
  if (keys.length === 0) return null;

  const preferredKey =
    keys.find((k) => k.toLowerCase().includes("metro manila")) ??
    keys.find((k) => k.toLowerCase().includes("manila")) ??
    keys[0];

  return preferredKey ? { label: preferredKey, entry: map[preferredKey] } : null;
}

function advisoryTone(level: string) {
  switch (level) {
    case "High":
      return "border-red-200 bg-red-50 text-red-900";
    case "Elevated":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Moderate":
      return "border-blue-200 bg-blue-50 text-blue-900";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-900";
  }
}

function buildForecastInformedOutlook(args: {
  weatherCondition?: string;
  causedBy?: string;
  impacts?: string;
  currentRainMmHr?: number | null;
  currentFloodDepthCm?: number | null;
  overflow?: boolean;
}) {
  const weatherCondition = cleanText(args.weatherCondition).toLowerCase();
  const causedBy = cleanText(args.causedBy).toLowerCase();
  const impacts = cleanText(args.impacts);

  const rain = args.currentRainMmHr ?? 0;
  const depth = args.currentFloodDepthCm ?? 0;
  const overflow = args.overflow === true;

  const rainBearing =
    weatherCondition.includes("rain") ||
    weatherCondition.includes("shower") ||
    weatherCondition.includes("thunder") ||
    weatherCondition.includes("storm") ||
    causedBy.includes("monsoon") ||
    causedBy.includes("low pressure") ||
    causedBy.includes("itcz") ||
    causedBy.includes("shear line") ||
    causedBy.includes("easterlies") ||
    causedBy.includes("trough");

  let level = "Low";
  let headline = "Low short-horizon flood concern";
  let advisory =
    "Regional forecast conditions do not currently suggest a strong short-horizon flood signal for the selected sensor area.";

  if (rainBearing) {
    level = "Moderate";
    headline = "Rain-bearing regional conditions detected";
    advisory =
      "PAGASA forecast conditions indicate a meaningful chance of rainfall. Continue watching your selected sensor and local drainage response through the day.";
  }

  if (rainBearing && (rain >= 10 || depth >= 10)) {
    level = "Elevated";
    headline = "Forecast and live readings both indicate concern";
    advisory =
      "Regional forecast guidance and your live local sensor values both suggest elevated flood potential over the next several hours.";
  }

  if (overflow || depth >= 20 || rain >= 20) {
    level = "High";
    headline = "Active local flood concern";
    advisory =
      "The live sensor already indicates concerning local conditions. Treat the forecast as supporting an active operational flood risk state rather than a distant possibility.";
  }

  if (impacts) {
    advisory += ` PAGASA noted: ${impacts}`;
  }

  return { level, headline, advisory };
}

function InfoCard({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-zinc-900">{value}</div>
      {subvalue ? (
        <div className="mt-1 text-xs text-zinc-500">{subvalue}</div>
      ) : null}
    </div>
  );
}

export default function PagasaForecastCard({
  selectedSensorName,
  zoneLabel,
  currentRainMmHr,
  currentFloodDepthCm,
  overflow,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forecast, setForecast] = useState<PagasaForecast | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadForecast() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch("/api/weather/pagasa", {
          cache: "no-store",
        });

        const json = (await res.json()) as UpstreamResponse;

        if (!res.ok || !json.ok) {
          throw new Error(
            (json.ok === false && json.error) || "Failed to load PAGASA forecast."
          );
        }

        if (!cancelled) {
          setForecast(json.forecast ?? null);
          setFetchedAt(json.fetchedAt ?? null);
          setCached(Boolean(json.cached));
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load PAGASA forecast."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadForecast();

    const id = window.setInterval(() => {
      void loadForecast();
    }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const weather = useMemo(
    () => findBestWeatherRow(forecast?.forecast_weather_conditions),
    [forecast]
  );

  const wind = useMemo(
    () => findBestWindRow(forecast?.forecast_wind_conditions),
    [forecast]
  );

  const temperatureEntry = useMemo(
    () => findBestTemperatureEntry(forecast?.temperature_humidity),
    [forecast]
  );

  const outlook = useMemo(
    () =>
      buildForecastInformedOutlook({
        weatherCondition: weather?.weather_condition,
        causedBy: weather?.caused_by,
        impacts: weather?.impacts,
        currentRainMmHr,
        currentFloodDepthCm,
        overflow,
      }),
    [weather, currentRainMmHr, currentFloodDepthCm, overflow]
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            PAGASA Forecast Context
          </div>
          <div className="mt-1 text-lg font-extrabold text-zinc-900">
            Regional 1-Day Guidance
          </div>
          <div className="mt-1 text-sm text-zinc-600">
            Daily forecast context combined with your selected sensor’s live
            rain and flood state.
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <div className="font-semibold text-zinc-700">Selected Sensor</div>
          <div>{selectedSensorName ?? "—"}</div>
          <div>{zoneLabel ?? "—"}</div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          Loading PAGASA forecast...
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : !forecast ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          No forecast available.
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
            <InfoCard
              label="Issued At"
              value={forecast.issued_at || "—"}
              subvalue={
                fetchedAt
                  ? `Fetched ${new Date(fetchedAt).toLocaleString()}${cached ? " • cached" : ""}`
                  : undefined
              }
            />
            <InfoCard
              label="Live Rain"
              value={`${fmt(currentRainMmHr, 1)} mm/hr`}
              subvalue="From selected sensor"
            />
            <InfoCard
              label="Live Flood Depth"
              value={`${fmt(currentFloodDepthCm, 1)} cm`}
              subvalue="From selected sensor"
            />
            <InfoCard
              label="Forecast-Informed Risk"
              value={outlook.level}
              subvalue={outlook.headline}
            />
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Synopsis
            </div>
            <div className="mt-2 text-sm leading-6 text-zinc-800">
              {cleanText(forecast.synopsis) || "—"}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-extrabold text-zinc-900">
                Weather Conditions
              </div>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <div>
                  <span className="font-semibold text-zinc-900">Area:</span>{" "}
                  {cleanText(weather?.place) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Condition:</span>{" "}
                  {cleanText(weather?.weather_condition) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Cause:</span>{" "}
                  {cleanText(weather?.caused_by) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Impacts:</span>{" "}
                  {cleanText(weather?.impacts) || "—"}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-extrabold text-zinc-900">
                Wind and Coastal Water
              </div>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <div>
                  <span className="font-semibold text-zinc-900">Area:</span>{" "}
                  {cleanText(wind?.place) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Speed:</span>{" "}
                  {cleanText(wind?.speed) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Direction:</span>{" "}
                  {cleanText(wind?.direction) || "—"}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Coastal Water:</span>{" "}
                  {cleanText(wind?.coastal_water) || "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-extrabold text-zinc-900">
                Temperature / Humidity
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {temperatureEntry?.label || "Reference Area"}
              </div>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <div>
                  <span className="font-semibold text-zinc-900">Max:</span>{" "}
                  {cleanText(temperatureEntry?.entry.max?.value) || "—"}{" "}
                  {cleanText(temperatureEntry?.entry.max?.time)
                    ? `at ${cleanText(temperatureEntry?.entry.max?.time)}`
                    : ""}
                </div>
                <div>
                  <span className="font-semibold text-zinc-900">Min:</span>{" "}
                  {cleanText(temperatureEntry?.entry.min?.value) || "—"}{" "}
                  {cleanText(temperatureEntry?.entry.min?.time)
                    ? `at ${cleanText(temperatureEntry?.entry.min?.time)}`
                    : ""}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-extrabold text-zinc-900">
                Astronomical Information
              </div>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                {forecast.astronomical_information &&
                Object.keys(forecast.astronomical_information).length > 0 ? (
                  Object.entries(forecast.astronomical_information).map(
                    ([key, value]) => (
                      <div key={key}>
                        <span className="font-semibold text-zinc-900">{key}:</span>{" "}
                        {cleanText(value) || "—"}
                      </div>
                    )
                  )
                ) : (
                  <div>—</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-extrabold text-zinc-900">
                Tidal Predictions
              </div>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                {forecast.tidal_predictions && forecast.tidal_predictions.length > 0 ? (
                  forecast.tidal_predictions.slice(0, 4).map((tide, index) => (
                    <div key={`${cleanText(tide.type)}-${cleanText(tide.time)}-${index}`}>
                      <span className="font-semibold text-zinc-900">
                        {cleanText(tide.type) || "Tide"}:
                      </span>{" "}
                      {cleanText(tide.value) || "—"}{" "}
                      {cleanText(tide.time) ? `at ${cleanText(tide.time)}` : ""}
                    </div>
                  ))
                ) : (
                  <div>—</div>
                )}
              </div>
            </div>
          </div>

          <div className={`mt-4 rounded-xl border p-4 ${advisoryTone(outlook.level)}`}>
            <div className="text-xs font-semibold uppercase tracking-wide">
              Forecast-Informed Advisory
            </div>
            <div className="mt-2 text-sm leading-6">{outlook.advisory}</div>
          </div>
        </>
      )}
    </section>
  );
}