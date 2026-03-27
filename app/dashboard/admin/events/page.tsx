"use client";

import { useEffect, useMemo, useState } from "react";
import { listRainEvents, type RainEventRecord } from "@/app/lib/eventsRepo";
import { listSensors, type SensorRecord } from "@/app/lib/sensorsRepo";

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusClasses(status: RainEventRecord["status"]) {
  return status === "ongoing"
    ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
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

export default function AdminEventsPage() {
  const [events, setEvents] = useState<RainEventRecord[]>([]);
  const [sensors, setSensors] = useState<SensorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAll() {
    try {
      setLoading(true);
      const [eventRows, sensorRows] = await Promise.all([
        listRainEvents(100),
        listSensors(),
      ]);

      setEvents(eventRows);
      setSensors(sensorRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rain events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const id = window.setInterval(loadAll, 15000);
    return () => window.clearInterval(id);
  }, []);

  const sensorNameMap = useMemo(() => {
    return new Map(sensors.map((s) => [s.id, s.name]));
  }, [sensors]);

  const counts = useMemo(() => {
    const ongoing = events.filter((e) => e.status === "ongoing").length;
    const resolved = events.filter((e) => e.status === "resolved").length;

    return {
      total: events.length,
      ongoing,
      resolved,
    };
  }, [events]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Admin Events
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Rain Events
            </h1>
            <div className="mt-1 text-sm text-zinc-600">
              Monitor ongoing and historical rain events derived from live sensor telemetry.
            </div>
          </div>

          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Total Events</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900">
              {loading ? "…" : counts.total}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Ongoing</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-blue-700">
              {loading ? "…" : counts.ongoing}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Resolved</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-emerald-700">
              {loading ? "…" : counts.resolved}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-4">
            <div className="text-base font-extrabold text-zinc-900">Event Timeline</div>
            <div className="mt-1 text-xs text-zinc-500">
              Most recent events first
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sensor</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Ended</th>
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Peak Rain</th>
                  <th className="px-4 py-3 font-semibold">Peak Depth</th>
                  <th className="px-4 py-3 font-semibold">Total Rain</th>
                  <th className="px-4 py-3 font-semibold">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-sm text-zinc-500">
                      No rain events recorded yet.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="border-t border-zinc-100">
                      <td className="px-4 py-3">
                        <div className="font-bold text-zinc-900">
                          {sensorNameMap.get(event.device_id) ?? event.device_id}
                        </div>
                        <div className="text-xs text-zinc-500">{event.device_id}</div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                            event.status
                          )}`}
                        >
                          {event.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-zinc-700">{fmtTime(event.started_at)}</td>
                      <td className="px-4 py-3 text-zinc-700">{fmtTime(event.ended_at)}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-900">
                        {durationText(event.started_at, event.ended_at)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-900">
                        {fmt(event.peak_rain_rate_mmh, 1)} mm/hr
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-900">
                        {fmt(event.peak_flood_depth_cm, 1)} cm
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-900">
                        {fmt(event.total_rain_mm, 2)} mm
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {event.trigger_reason ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}