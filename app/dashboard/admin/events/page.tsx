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

export default function AdminEventsPage() {
  const [events, setEvents] = useState<RainEventRecord[]>([]);
  const [sensors, setSensors] = useState<SensorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [startAt, setStartAt] = useState(toDateTimeLocalInputValue(new Date()));
  const [endAt, setEndAt] = useState("");
  const [createAsOngoing, setCreateAsOngoing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [endingEventId, setEndingEventId] = useState<number | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [regeneratingEventId, setRegeneratingEventId] = useState<number | null>(null);

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

      const [eventRows, sensorRows] = await Promise.all([
        listRainEvents(100),
        listSensors(),
      ]);

      setEvents(eventRows);
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

  const counts = useMemo(() => {
    const ongoing = events.filter((e) => e.status === "ongoing").length;
    const resolved = events.filter((e) => e.status === "resolved").length;
    const cancelled = events.filter((e) => e.status === "cancelled").length;

    return {
      total: events.length,
      ongoing,
      resolved,
      cancelled,
    };
  }, [events]);

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
              Monitor, create, regenerate, end, delete, and export rain events derived from sensor readings.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadAll()}
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

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
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

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Cancelled</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-700">
              {loading ? "…" : counts.cancelled}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-base font-extrabold text-zinc-900">Create Event Manually</div>
          <div className="mt-1 text-sm text-zinc-600">
            Pick a sensor and a time window. The backend will fetch matching sensor readings and build the event summary automatically.
          </div>

          <form onSubmit={handleCreateManualEvent} className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-1">
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

            <div className="lg:col-span-1">
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

            <div className="lg:col-span-1">
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
              <label className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
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

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-4">
            <div className="text-base font-extrabold text-zinc-900">Event Timeline</div>
            <div className="mt-1 text-xs text-zinc-500">Most recent events first</div>
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
                  <th className="px-4 py-3 font-semibold">End Reason</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-sm text-zinc-500">
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
                      <td className="px-4 py-3 text-zinc-700">
                        {event.ended_reason ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownloadCsv(event.id)}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                          >
                            Download CSV
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
                              {endingEventId === event.id ? "Ending..." : "End Event"}
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