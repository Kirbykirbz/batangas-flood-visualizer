"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type PublicRainEvent = {
  id: number;
  device_id: string;
  sensor_name: string | null;
  zone_label: string | null;
  started_at: string;
  ended_at: string | null;
  status: "ongoing" | "resolved" | "cancelled" | string;
  trigger_reason: string | null;
  ended_reason: string | null;
  total_rain_mm: number;
  peak_rain_rate_mmh: number;
  peak_flood_depth_cm: number;
  total_tips: number;
  last_tip_at: string | null;
};

type EventsApiResponse =
  | {
      ok: true;
      events: PublicRainEvent[];
    }
  | {
      ok: false;
      error: string;
    };

type ChartPoint = {
  ts: string;
  rainRate: number | null;
  floodDepth: number | null;
};

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function durationText(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";

  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;

  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function statusClasses(status: string) {
  switch (status) {
    case "ongoing":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "cancelled":
      return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200";
    default:
      return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200";
  }
}

function parseCsvSimple(csv: string): Record<string, string>[] {
  const lines = csv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const parseLine = (line: string) => {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        out.push(current);
        current = "";
        continue;
      }

      current += ch;
    }

    out.push(current);
    return out;
  };

  const headers = parseLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

function numOrNull(value: string | undefined) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildChartPointsFromCsv(csv: string): ChartPoint[] {
  const rows = parseCsvSimple(csv);

  return rows
    .map((row) => {
      const ts =
        row.reading_ts ||
        row.created_at ||
        row.ts ||
        row.timestamp ||
        row.time ||
        "";

      const rainRate =
        numOrNull(row.rain_rate_mmh_300) ??
        numOrNull(row.rain_rate_mmh_60) ??
        numOrNull(row.rain_rate_mmh);

      const floodDepth =
        numOrNull(row.flood_depth_cm) ??
        null;

      return {
        ts,
        rainRate,
        floodDepth,
      };
    })
    .filter((point) => point.ts);
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
        {value}
      </div>
      {subtitle ? (
        <div className="mt-2 text-xs leading-5 text-zinc-500 sm:text-sm">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function AxisChart({
  title,
  subtitle,
  values,
  width = 900,
  height = 260,
}: {
  title: string;
  subtitle: string;
  values: Array<number | null>;
  width?: number;
  height?: number;
}) {
  const validValues = values.filter(
    (v): v is number => v != null && Number.isFinite(v)
  );

  if (validValues.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-extrabold text-zinc-900">{title}</div>
        <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
        <div className="mt-4 text-sm text-zinc-500">No chartable data.</div>
      </div>
    );
  }

  const maxValue = Math.max(...validValues, 1);
  const minValue = 0;
  const leftPad = 56;
  const rightPad = 16;
  const topPad = 16;
  const bottomPad = 34;

  const innerWidth = width - leftPad - rightPad;
  const innerHeight = height - topPad - bottomPad;

  const scaleX = (index: number) =>
    values.length <= 1 ? leftPad : leftPad + (index / (values.length - 1)) * innerWidth;

  const scaleY = (value: number) =>
    topPad + innerHeight - ((value - minValue) / Math.max(maxValue - minValue, 1)) * innerHeight;

  const ticksY = 4;
  const yGuides = Array.from({ length: ticksY + 1 }, (_, i) => {
    const ratio = i / ticksY;
    const value = maxValue - ratio * (maxValue - minValue);
    const y = topPad + ratio * innerHeight;
    return { value, y };
  });

  let path = "";
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) return;
    const x = scaleX(index);
    const y = scaleY(value);
    path += `${path ? " L " : "M "}${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-extrabold text-zinc-900">{title}</div>
      <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-72 min-w-[760px] w-full"
          preserveAspectRatio="none"
        >
          {yGuides.map((guide, index) => (
            <g key={index}>
              <line
                x1={leftPad}
                y1={guide.y}
                x2={width - rightPad}
                y2={guide.y}
                stroke="#e4e4e7"
                strokeDasharray="4 4"
              />
              <text
                x={leftPad - 8}
                y={guide.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#71717a"
              >
                {guide.value.toFixed(1)}
              </text>
            </g>
          ))}

          <line
            x1={leftPad}
            y1={topPad}
            x2={leftPad}
            y2={topPad + innerHeight}
            stroke="#a1a1aa"
          />
          <line
            x1={leftPad}
            y1={topPad + innerHeight}
            x2={width - rightPad}
            y2={topPad + innerHeight}
            stroke="#a1a1aa"
          />

          <path
            d={path}
            fill="none"
            stroke="#18181b"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {values.map((value, index) => {
            if (value == null || !Number.isFinite(value)) return null;
            const x = scaleX(index);
            const y = scaleY(value);
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r="3.5"
                fill="#18181b"
              />
            );
          })}

          <text
            x={leftPad}
            y={height - 8}
            fontSize="11"
            fill="#71717a"
          >
            Time progression →
          </text>
        </svg>
      </div>
    </div>
  );
}

function ChartModal({
  open,
  event,
  sensorName,
  onClose,
}: {
  open: boolean;
  event: PublicRainEvent | null;
  sensorName: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [points, setPoints] = useState<ChartPoint[]>([]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !event) return;

    let cancelled = false;

    async function loadChart() {
      try {
        setLoading(true);
        setError("");
        setPoints([]);

        const res = await fetch(`/api/events/${event!.id}/export`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `Failed to load event CSV (${res.status}): ${text.slice(0, 160)}`
          );
        }

        const csv = await res.text();
        const nextPoints = buildChartPointsFromCsv(csv);

        if (!cancelled) {
          setPoints(nextPoints);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load event chart data."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadChart();

    return () => {
      cancelled = true;
    };
  }, [open, event]);

  if (!open || !event) return null;

  const rainValues = points.map((p) => p.rainRate);
  const floodValues = points.map((p) => p.floodDepth);

  const rainMax = points.reduce((acc, p) => Math.max(acc, p.rainRate ?? 0), 0);
  const floodMax = points.reduce((acc, p) => Math.max(acc, p.floodDepth ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-6">
          <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <div className="text-base font-extrabold text-zinc-900 sm:text-lg">
                  Event Visualization
                </div>
                <div className="mt-1 text-sm text-zinc-600">
                  {sensorName ?? event.device_id}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {fmtTime(event.started_at)} → {fmtTime(event.ended_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <StatCard title="Total Tips" value={fmtInt(event.total_tips)} />
                <StatCard title="Total Rain" value={`${fmt(event.total_rain_mm, 2)} mm`} />
                <StatCard
                  title="Peak Rain Intensity"
                  value={`${fmt(event.peak_rain_rate_mmh, 2)} mm/hr`}
                />
                <StatCard
                  title="Peak Flood Depth"
                  value={`${fmt(event.peak_flood_depth_cm, 1)} cm`}
                />
              </div>

              {error && (
                <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
                  Loading event chart data...
                </div>
              ) : points.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
                  No chartable readings found for this event.
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  <AxisChart
                    title="Rain Intensity"
                    subtitle={`Y-axis: mm/hr intensity • Peak observed: ${fmt(rainMax, 2)} mm/hr`}
                    values={rainValues}
                  />

                  <AxisChart
                    title="Flood Depth"
                    subtitle={`Y-axis: cm depth • Peak observed: ${fmt(floodMax, 1)} cm`}
                    values={floodValues}
                  />

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Interpretation
                    </div>
                    <div className="mt-2 space-y-1 text-sm leading-6 text-zinc-700">
                      <div>
                        Peak rain is a rate estimate in <span className="font-semibold">mm/hr</span>.
                      </div>
                      <div>
                        Total rain is the accumulated event rainfall in <span className="font-semibold">mm</span>.
                      </div>
                      <div>
                        Total tips shows how many bucket tips occurred during the event.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-zinc-200 bg-white px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => window.open(`/api/events/${event.id}/export`, "_blank")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                >
                  Download CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default function PublicEventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<PublicRainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filterSensorId, setFilterSensorId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | PublicRainEvent["status"]>("all");
  const [searchText, setSearchText] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(20);

  async function loadEvents() {
    try {
      setLoading(true);

      const res = await fetch("/api/events?limit=200", {
        cache: "no-store",
      });

      const json = (await res.json()) as EventsApiResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to load rain events." : json.error);
      }

      setEvents(json.events);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rain events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();

    const id = window.setInterval(() => {
      void loadEvents();
    }, 30000);

    return () => window.clearInterval(id);
  }, []);

  const sensorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();

    for (const event of events) {
      if (!map.has(event.device_id)) {
        map.set(event.device_id, {
          id: event.device_id,
          name: event.sensor_name ?? event.device_id,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    return events.filter((event) => {
      if (filterSensorId !== "all" && event.device_id !== filterSensorId) {
        return false;
      }

      if (filterStatus !== "all" && event.status !== filterStatus) {
        return false;
      }

      if (!q) return true;

      const haystack = [
        event.device_id,
        event.sensor_name ?? "",
        event.zone_label ?? "",
        event.trigger_reason ?? "",
        event.ended_reason ?? "",
        event.status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [events, filterSensorId, filterStatus, searchText]);

  const visibleEvents = useMemo(() => {
    return filteredEvents.slice(0, rowsPerPage);
  }, [filteredEvents, rowsPerPage]);

  const counts = useMemo(() => {
    const ongoing = filteredEvents.filter((e) => e.status === "ongoing").length;
    const resolved = filteredEvents.filter((e) => e.status === "resolved").length;
    const cancelled = filteredEvents.filter((e) => e.status === "cancelled").length;

    const totalTips = filteredEvents.reduce((sum, event) => {
      return sum + Number(event.total_tips ?? 0);
    }, 0);

    const totalRainMm = filteredEvents.reduce((sum, event) => {
      return sum + Number(event.total_rain_mm ?? 0);
    }, 0);

    return {
      total: filteredEvents.length,
      ongoing,
      resolved,
      cancelled,
      totalTips,
      totalRainMm,
    };
  }, [filteredEvents]);

  const selectedEventId = searchParams.get("event");
  const chartEvent = useMemo(() => {
    if (!selectedEventId) return null;
    const idNum = Number(selectedEventId);
    if (!Number.isFinite(idNum)) return null;
    return events.find((event) => event.id === idNum) ?? null;
  }, [events, selectedEventId]);

  function openChart(eventId: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", String(eventId));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeChart() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("event");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4 sm:py-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Public Event Archive
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Rain Events
            </h1>
            <div className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
              View historical and ongoing rain events, inspect event summaries,
              and download read-only CSV reports.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadEvents()}
            className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard title="Visible Events" value={loading ? "…" : String(counts.total)} />
          <StatCard title="Ongoing" value={loading ? "…" : String(counts.ongoing)} />
          <StatCard title="Resolved" value={loading ? "…" : String(counts.resolved)} />
          <StatCard title="Cancelled" value={loading ? "…" : String(counts.cancelled)} />
          <StatCard title="Total Tips" value={loading ? "…" : fmtInt(counts.totalTips)} />
          <StatCard
            title="Aggregated Rain"
            value={loading ? "…" : `${fmt(counts.totalRainMm, 2)} mm`}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="text-base font-extrabold text-zinc-900">Filters</div>
          <div className="mt-1 text-sm text-zinc-600">
            Filter by sensor, status, keywords, or row count.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sensor
              </label>
              <select
                value={filterSensorId}
                onChange={(e) => setFilterSensorId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
              >
                <option value="all">All sensors</option>
                {sensorOptions.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name} — {sensor.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Search
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Sensor, trigger, reason..."
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Rows
              </label>
              <select
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
              >
                <option value={10}>10 rows</option>
                <option value={20}>20 rows</option>
                <option value={30}>30 rows</option>
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Status
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <FilterChip active={filterStatus === "all"} onClick={() => setFilterStatus("all")}>
                  All
                </FilterChip>
                <FilterChip
                  active={filterStatus === "ongoing"}
                  onClick={() => setFilterStatus("ongoing")}
                >
                  Ongoing
                </FilterChip>
                <FilterChip
                  active={filterStatus === "resolved"}
                  onClick={() => setFilterStatus("resolved")}
                >
                  Resolved
                </FilterChip>
                <FilterChip
                  active={filterStatus === "cancelled"}
                  onClick={() => setFilterStatus("cancelled")}
                >
                  Cancelled
                </FilterChip>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
            <div className="text-base font-extrabold text-zinc-900">Event Timeline</div>
            <div className="mt-1 text-xs text-zinc-500">
              All per-event summary values come directly from the rain_events table.
            </div>
          </div>

          <div className="block lg:hidden">
            {visibleEvents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500">
                No rain events recorded yet.
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {visibleEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-zinc-900">
                          {event.sensor_name ?? event.device_id}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {event.zone_label ?? event.device_id}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                          event.status
                        )}`}
                      >
                        {event.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Started</div>
                        <div className="mt-1 text-zinc-800">{fmtTime(event.started_at)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Duration</div>
                        <div className="mt-1 font-semibold text-zinc-900">
                          {durationText(event.started_at, event.ended_at)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Tips</div>
                        <div className="mt-1 font-semibold text-zinc-900">
                          {fmtInt(event.total_tips)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Total Rain</div>
                        <div className="mt-1 font-semibold text-zinc-900">
                          {fmt(event.total_rain_mm, 2)} mm
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Peak Rain</div>
                        <div className="mt-1 font-semibold text-zinc-900">
                          {fmt(event.peak_rain_rate_mmh, 2)} mm/hr
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-500">Peak Depth</div>
                        <div className="mt-1 font-semibold text-zinc-900">
                          {fmt(event.peak_flood_depth_cm, 1)} cm
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openChart(event.id)}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 shadow-sm hover:bg-blue-100"
                      >
                        View Chart
                      </button>

                      <button
                        type="button"
                        onClick={() => window.open(`/api/events/${event.id}/export`, "_blank")}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                      >
                        Download CSV
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sensor</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Ended</th>
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Total Tips</th>
                  <th className="px-4 py-3 font-semibold">Peak Rain</th>
                  <th className="px-4 py-3 font-semibold">Peak Depth</th>
                  <th className="px-4 py-3 font-semibold">Total Rain</th>
                  <th className="px-4 py-3 font-semibold">Last Tip</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-sm text-zinc-500">
                      No rain events recorded yet.
                    </td>
                  </tr>
                ) : (
                  visibleEvents.map((event) => (
                    <tr key={event.id} className="border-t border-zinc-100">
                      <td className="px-4 py-3 align-top">
                        <div className="font-bold text-zinc-900">
                          {event.sensor_name ?? event.device_id}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {event.zone_label ?? event.device_id}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                            event.status
                          )}`}
                        >
                          {event.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top text-zinc-700">
                        {fmtTime(event.started_at)}
                      </td>

                      <td className="px-4 py-3 align-top text-zinc-700">
                        {fmtTime(event.ended_at)}
                      </td>

                      <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                        {durationText(event.started_at, event.ended_at)}
                      </td>

                      <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                        {fmtInt(event.total_tips)}
                      </td>

                      <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                        {fmt(event.peak_rain_rate_mmh, 2)} mm/hr
                      </td>

                      <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                        {fmt(event.peak_flood_depth_cm, 1)} cm
                      </td>

                      <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                        {fmt(event.total_rain_mm, 2)} mm
                      </td>

                      <td className="px-4 py-3 align-top text-zinc-700">
                        {fmtTime(event.last_tip_at)}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openChart(event.id)}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 shadow-sm hover:bg-blue-100"
                          >
                            View Chart
                          </button>

                          <button
                            type="button"
                            onClick={() => window.open(`/api/events/${event.id}/export`, "_blank")}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                          >
                            Download CSV
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ChartModal
        open={!!chartEvent}
        event={chartEvent}
        sensorName={chartEvent ? chartEvent.sensor_name ?? chartEvent.device_id : null}
        onClose={closeChart}
      />
    </div>
  );
}