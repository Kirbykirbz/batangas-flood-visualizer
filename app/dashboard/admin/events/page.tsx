"use client";

import { useEffect, useMemo, useState } from "react";
import { type RainEventRecord } from "@/app/lib/eventsRepo";
import { listSensors, type SensorRecord } from "@/app/lib/sensorsRepo";

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

function toDateTimeLocalInputValue(value?: Date | string | null) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function statusClasses(status: RainEventRecord["status"]) {
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

type JsonOk = { ok: true; [key: string]: unknown };
type JsonErr = { ok: false; error: string };
type JsonResponse = JsonOk | JsonErr;

type AdminEventsApiResponse =
  | {
      ok: true;
      events: RainEventRecord[];
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

      const floodDepth = numOrNull(row.flood_depth_cm) ?? null;

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
            return <circle key={index} cx={x} cy={y} r="3.5" fill="#18181b" />;
          })}

          <text x={leftPad} y={height - 8} fontSize="11" fill="#71717a">
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
  event: RainEventRecord | null;
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

    const eventId = event.id;
    let cancelled = false;

    async function loadChart() {
      try {
        setLoading(true);
        setError("");
        setPoints([]);

        const res = await fetch(`/api/admin/events/${eventId}/export`, {
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-extrabold text-zinc-900 sm:text-lg">
                    Event Visualization
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                      event.status
                    )}`}
                  >
                    {event.status.toUpperCase()}
                  </span>
                </div>

                <div className="mt-2 text-sm font-semibold text-zinc-800">
                  {sensorName ?? event.device_id}
                </div>

                <div className="mt-1 text-xs text-zinc-500">
                  Device ID: {event.device_id}
                </div>

                <div className="mt-2 text-xs text-zinc-500">
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

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Event Metadata
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Trigger Reason
                      </div>
                      <div className="mt-1 text-sm leading-6 text-zinc-800">
                        {event.trigger_reason ?? "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        End Reason
                      </div>
                      <div className="mt-1 text-sm leading-6 text-zinc-800">
                        {event.ended_reason ?? "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Last Tip
                      </div>
                      <div className="mt-1 text-sm leading-6 text-zinc-800">
                        {fmtTime(event.last_tip_at)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Duration
                      </div>
                      <div className="mt-1 text-sm leading-6 text-zinc-800">
                        {durationText(event.started_at, event.ended_at)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Interpretation
                  </div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-700">
                    <div>
                      Peak rain is a rate estimate in <span className="font-semibold">mm/hr</span>.
                    </div>
                    <div>
                      Total rain is the accumulated event rainfall in <span className="font-semibold">mm</span>.
                    </div>
                    <div>
                      Total tips shows how many bucket tips occurred during the event.
                    </div>
                    <div>
                      Trigger and end reason help validate whether the lifecycle logic behaved correctly for this event.
                    </div>
                  </div>
                </div>
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
                  onClick={() => window.open(`/api/admin/events/${event.id}/export`, "_blank")}
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

function FragmentRow({
  compactRow,
  expandedRow,
}: {
  compactRow: React.ReactNode;
  expandedRow: React.ReactNode;
}) {
  return (
    <>
      {compactRow}
      {expandedRow}
    </>
  );
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<RainEventRecord[]>([]);
  const [sensors, setSensors] = useState<SensorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [startAt, setStartAt] = useState(toDateTimeLocalInputValue(new Date()));
  const [endAt, setEndAt] = useState("");
  const [createAsOngoing, setCreateAsOngoing] = useState(false);

  const [filterSensorId, setFilterSensorId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | RainEventRecord["status"]>("all");
  const [searchText, setSearchText] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [expandedEventIds, setExpandedEventIds] = useState<Record<number, boolean>>({});

  const [creating, setCreating] = useState(false);
  const [endingEventId, setEndingEventId] = useState<number | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [regeneratingEventId, setRegeneratingEventId] = useState<number | null>(null);

  const [chartEvent, setChartEvent] = useState<RainEventRecord | null>(null);

  async function parseJsonResponse(res: Response): Promise<JsonResponse> {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(
        `Expected JSON but got ${contentType || "unknown content-type"}.\n${text.slice(0, 200)}`
      );
    }
    return (await res.json()) as JsonResponse;
  }

  async function loadAll() {
    try {
      setLoading(true);

      const [eventsRes, sensorRows] = await Promise.all([
        fetch("/api/admin/events?limit=100", { cache: "no-store" }),
        listSensors(),
      ]);

      const eventsJson = (await eventsRes.json()) as AdminEventsApiResponse;

      if (!eventsRes.ok || !eventsJson.ok) {
        throw new Error(
          eventsJson.ok ? "Failed to load rain events." : eventsJson.error
        );
      }

      setEvents(eventsJson.events ?? []);
      setSensors(sensorRows);
      setError("");

      if (!selectedSensorId && sensorRows.length > 0) {
        setSelectedSensorId(sensorRows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rain events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();

    const id = window.setInterval(() => {
      void loadAll();
    }, 15000);

    return () => window.clearInterval(id);
  }, []);

  const sensorNameMap = useMemo(() => {
    return new Map(sensors.map((s) => [s.id, s.name]));
  }, [sensors]);

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

      const sensorName = sensorNameMap.get(event.device_id) ?? "";
      const haystack = [
        event.device_id,
        sensorName,
        event.trigger_reason ?? "",
        event.ended_reason ?? "",
        event.status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [events, filterSensorId, filterStatus, searchText, sensorNameMap]);

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

  async function handleCreateManualEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      setCreating(true);
      setError("");

      if (!selectedSensorId) {
        throw new Error("Please select a sensor.");
      }

      if (!startAt) {
        throw new Error("Please provide a start date/time.");
      }

      if (!createAsOngoing && !endAt) {
        throw new Error("Please provide an end date/time or mark it as ongoing.");
      }

      const startedAtIso = new Date(startAt).toISOString();
      const endedAtIso = createAsOngoing ? null : new Date(endAt).toISOString();

      if (Number.isNaN(new Date(startedAtIso).getTime())) {
        throw new Error("Invalid start date/time.");
      }

      if (!createAsOngoing) {
        if (!endedAtIso || Number.isNaN(new Date(endedAtIso).getTime())) {
          throw new Error("Invalid end date/time.");
        }

        if (new Date(endedAtIso).getTime() <= new Date(startedAtIso).getTime()) {
          throw new Error("End date/time must be after the start date/time.");
        }
      }

      const res = await fetch("/api/admin/events/manual-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: selectedSensorId,
          startedAt: startedAtIso,
          endedAt: endedAtIso,
        }),
      });

      const json = await parseJsonResponse(res);

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to create event." : json.error);
      }

      setEndAt("");
      setCreateAsOngoing(false);
      setCreateOpen(false);

      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setCreating(false);
    }
  }

  async function handleEndEvent(eventId: number) {
    try {
      setEndingEventId(eventId);
      setError("");

      const res = await fetch(`/api/admin/events/${eventId}/end`, {
        method: "POST",
      });

      const json = await parseJsonResponse(res);

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to end event." : json.error);
      }

      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end event.");
    } finally {
      setEndingEventId(null);
    }
  }

  async function handleDeleteEvent(eventId: number) {
    const confirmed = window.confirm(
      "Delete this rain event? This removes the event summary record only."
    );
    if (!confirmed) return;

    try {
      setDeletingEventId(eventId);
      setError("");

      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: "DELETE",
      });

      const json = await parseJsonResponse(res);

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to delete event." : json.error);
      }

      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete event.");
    } finally {
      setDeletingEventId(null);
    }
  }

  async function handleRegenerateEvent(eventId: number) {
    try {
      setRegeneratingEventId(eventId);
      setError("");

      const res = await fetch(`/api/admin/events/${eventId}/regenerate`, {
        method: "POST",
      });

      const json = await parseJsonResponse(res);

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to regenerate event." : json.error);
      }

      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate event.");
    } finally {
      setRegeneratingEventId(null);
    }
  }

  function handleDownloadCsv(eventId: number) {
    window.open(`/api/admin/events/${eventId}/export`, "_blank");
  }

  function toggleExpanded(eventId: number) {
    setExpandedEventIds((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4 sm:py-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Admin Events
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Rain Events
            </h1>
            <div className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
              Monitor, filter, regenerate, end, delete, and export rain events
              derived from sensor readings.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadAll()}
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

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5"
            >
              <div>
                <div className="text-base font-extrabold text-zinc-900">Filters</div>
                <div className="mt-1 text-sm text-zinc-600">
                  Narrow the table and cards by sensor, status, keyword, and rows.
                </div>
              </div>
              <div className="text-sm font-bold text-zinc-500">
                {filtersOpen ? "Hide" : "Show"}
              </div>
            </button>

            {filtersOpen && (
              <div className="border-t border-zinc-200 px-4 py-4 sm:px-5">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
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
                      {sensors.map((sensor) => (
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
                      <FilterChip
                        active={filterStatus === "all"}
                        onClick={() => setFilterStatus("all")}
                      >
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
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5"
            >
              <div>
                <div className="text-base font-extrabold text-zinc-900">
                  Create Event Manually
                </div>
                <div className="mt-1 text-sm text-zinc-600">
                  Collapsed by default to keep the admin surface cleaner.
                </div>
              </div>
              <div className="text-sm font-bold text-zinc-500">
                {createOpen ? "Hide" : "Show"}
              </div>
            </button>

            {createOpen && (
              <div className="border-t border-zinc-200 px-4 py-4 sm:px-5">
                <form
                  onSubmit={handleCreateManualEvent}
                  className="grid grid-cols-1 gap-4 xl:grid-cols-5"
                >
                  <div className="xl:col-span-1">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Sensor
                    </label>
                    <select
                      value={selectedSensorId}
                      onChange={(e) => setSelectedSensorId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
                    >
                      <option value="">Select sensor</option>
                      {sensors.map((sensor) => (
                        <option key={sensor.id} value={sensor.id}>
                          {sensor.name} — {sensor.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="xl:col-span-1">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Start
                    </label>
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm"
                    />
                  </div>

                  <div className="xl:col-span-1">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      End
                    </label>
                    <input
                      type="datetime-local"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                      disabled={createAsOngoing}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-sm disabled:bg-zinc-100 disabled:text-zinc-400"
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="inline-flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
                      <input
                        type="checkbox"
                        checked={createAsOngoing}
                        onChange={(e) => setCreateAsOngoing(e.target.checked)}
                      />
                      Create as ongoing
                    </label>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={creating}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-200 bg-gray-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-gray-800 disabled:opacity-60"
                    >
                      {creating ? "Creating..." : "Create Event"}
                    </button>
                  </div>
                </form>
              </div>
            )}
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
                {visibleEvents.map((event) => {
                  const expanded = !!expandedEventIds[event.id];
                  return (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-zinc-900">
                            {sensorNameMap.get(event.device_id) ?? event.device_id}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {event.device_id}
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
                      </div>

                      {expanded && (
                        <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-xs font-semibold text-zinc-500">Ended</div>
                              <div className="mt-1 text-zinc-800">{fmtTime(event.ended_at)}</div>
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-zinc-500">Last Tip</div>
                              <div className="mt-1 text-zinc-800">{fmtTime(event.last_tip_at)}</div>
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

                          <div>
                            <div className="text-xs font-semibold text-zinc-500">Trigger</div>
                            <div className="mt-1 text-sm leading-6 text-zinc-700">
                              {event.trigger_reason ?? "—"}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-zinc-500">End Reason</div>
                            <div className="mt-1 text-sm leading-6 text-zinc-700">
                              {event.ended_reason ?? "—"}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(event.id)}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                        >
                          {expanded ? "Collapse" : "Expand"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setChartEvent(event)}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 shadow-sm hover:bg-blue-100"
                        >
                          View Chart
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDownloadCsv(event.id)}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                        >
                          CSV
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleRegenerateEvent(event.id)}
                          disabled={regeneratingEventId === event.id}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 shadow-sm hover:bg-amber-100 disabled:opacity-60"
                        >
                          {regeneratingEventId === event.id ? "Regenerating..." : "Regenerate"}
                        </button>

                        {event.status === "ongoing" && (
                          <button
                            type="button"
                            onClick={() => void handleEndEvent(event.id)}
                            disabled={endingEventId === event.id}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-60"
                          >
                            {endingEventId === event.id ? "Ending..." : "End"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void handleDeleteEvent(event.id)}
                          disabled={deletingEventId === event.id}
                          className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-200 disabled:opacity-60"
                        >
                          {deletingEventId === event.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Tips</th>
                  <th className="px-4 py-3 font-semibold">Peak Rain</th>
                  <th className="px-4 py-3 font-semibold">Peak Depth</th>
                  <th className="px-4 py-3 font-semibold">Total Rain</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-sm text-zinc-500">
                      No rain events recorded yet.
                    </td>
                  </tr>
                ) : (
                  visibleEvents.map((event) => {
                    const expanded = !!expandedEventIds[event.id];

                    return (
                      <FragmentRow
                        key={event.id}
                        compactRow={
                          <tr className="border-t border-zinc-100">
                            <td className="px-4 py-3 align-top">
                              <div className="font-bold text-zinc-900">
                                {sensorNameMap.get(event.device_id) ?? event.device_id}
                              </div>
                              <div className="text-xs text-zinc-500">{event.device_id}</div>
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

                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(event.id)}
                                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                                >
                                  {expanded ? "Collapse" : "Expand"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setChartEvent(event)}
                                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 shadow-sm hover:bg-blue-100"
                                >
                                  Chart
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDownloadCsv(event.id)}
                                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                                >
                                  CSV
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateEvent(event.id)}
                                  disabled={regeneratingEventId === event.id}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 shadow-sm hover:bg-amber-100 disabled:opacity-60"
                                >
                                  {regeneratingEventId === event.id ? "Regenerating..." : "Regenerate"}
                                </button>

                                {event.status === "ongoing" && (
                                  <button
                                    type="button"
                                    onClick={() => void handleEndEvent(event.id)}
                                    disabled={endingEventId === event.id}
                                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-60"
                                  >
                                    {endingEventId === event.id ? "Ending..." : "End"}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => void handleDeleteEvent(event.id)}
                                  disabled={deletingEventId === event.id}
                                  className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-200 disabled:opacity-60"
                                >
                                  {deletingEventId === event.id ? "Deleting..." : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        }
                        expandedRow={
                          expanded ? (
                            <tr className="border-t border-zinc-50 bg-zinc-50/70">
                              <td colSpan={9} className="px-4 py-4">
                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      Ended
                                    </div>
                                    <div className="mt-1 text-sm text-zinc-800">
                                      {fmtTime(event.ended_at)}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      Last Tip
                                    </div>
                                    <div className="mt-1 text-sm text-zinc-800">
                                      {fmtTime(event.last_tip_at)}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      Trigger
                                    </div>
                                    <div className="mt-1 text-sm text-zinc-700">
                                      {event.trigger_reason ?? "—"}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      End Reason
                                    </div>
                                    <div className="mt-1 text-sm text-zinc-700">
                                      {event.ended_reason ?? "—"}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null
                        }
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ChartModal
        open={!!chartEvent}
        event={chartEvent}
        sensorName={
          chartEvent
            ? sensorNameMap.get(chartEvent.device_id) ?? chartEvent.device_id
            : null
        }
        onClose={() => setChartEvent(null)}
      />
    </div>
  );
}