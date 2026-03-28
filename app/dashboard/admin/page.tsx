"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listSensors, type SensorRecord } from "@/app/lib/sensorsRepo";
import {
  listFeedbackMessages,
  type FeedbackMessageRecord,
} from "@/app/lib/feedbackRepo";
import type { SensorPoint } from "@/app/lib/sensorStore";
import {
  extractBatteryPercentage,
  extractFloodDepthCm,
  extractRainMmHr,
  extractRssiDbm,
  extractTimestampMs,
  isOverflow,
} from "@/app/lib/sensorReading";

type Payload = {
  latest: SensorPoint | null;
  recent: SensorPoint[];
  latestByDevice?: Record<string, SensorPoint>;
  serverTime: number;
};

type SensorHealthRow = {
  id: string;
  name: string;
  zoneLabel: string | null;
  isActive: boolean;
  latestTsMs: number | null;
  isStale: boolean;
  rainMmHr: number;
  floodDepthCm: number;
  overflow: boolean;
  batteryPercentage: number | null;
  rssiDbm: number | null;
};

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function fmtTime(tsMs: number | null) {
  if (!tsMs) return "—";
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusPillClasses(tone: "ok" | "warn" | "bad" | "neutral") {
  switch (tone) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "warn":
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
    case "bad":
      return "bg-red-50 text-red-800 ring-1 ring-red-200";
    default:
      return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
  }
}

function feedbackStatusClasses(status: FeedbackMessageRecord["status"]) {
  switch (status) {
    case "resolved":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "read":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    default:
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
}

function cardValueToneClasses(tone: "default" | "ok" | "warn" | "bad") {
  switch (tone) {
    case "ok":
      return "text-emerald-700";
    case "warn":
      return "text-amber-700";
    case "bad":
      return "text-red-700";
    default:
      return "text-zinc-900";
  }
}

function actionButtonClasses(variant: "default" | "primary" = "default") {
  if (variant === "primary") {
    return "inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-zinc-800";
  }

  return "inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50";
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="text-base font-extrabold text-zinc-900">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function StatCard({
  title,
  value,
  tone = "default",
  subtitle,
}: {
  title: string;
  value: string | number;
  tone?: "default" | "ok" | "warn" | "bad";
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      <div
        className={`mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl ${cardValueToneClasses(
          tone
        )}`}
      >
        {value}
      </div>
      <div className="mt-2 text-sm text-zinc-500">{subtitle}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [sensors, setSensors] = useState<SensorRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackMessageRecord[]>([]);
  const [latestByDevice, setLatestByDevice] = useState<Record<string, SensorPoint>>(
    {}
  );
  const [serverTime, setServerTime] = useState<number>(0);

  const [loadingSensors, setLoadingSensors] = useState(true);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [loadingTelemetry, setLoadingTelemetry] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSensorsData() {
      try {
        setLoadingSensors(true);
        const rows = await listSensors();
        if (!cancelled) setSensors(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sensors.");
        }
      } finally {
        if (!cancelled) setLoadingSensors(false);
      }
    }

    void loadSensorsData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFeedbackData() {
      try {
        setLoadingFeedback(true);
        const rows = await listFeedbackMessages(8);
        if (!cancelled) setFeedback(rows);
      } catch (err) {
        if (!cancelled) {
          setError((prev) =>
            prev || (err instanceof Error ? err.message : "Failed to load feedback.")
          );
        }
      } finally {
        if (!cancelled) setLoadingFeedback(false);
      }
    }

    void loadFeedbackData();
    const id = window.setInterval(loadFeedbackData, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTelemetry() {
      try {
        setLoadingTelemetry(true);
        const res = await fetch(`/api/data?limit=300&t=${Date.now()}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Telemetry API ${res.status}: ${text}`);
        }

        const json: Payload = await res.json();

        if (!cancelled) {
          setLatestByDevice(json.latestByDevice ?? {});
          setServerTime(json.serverTime ?? 0);
        }
      } catch (err) {
        if (!cancelled) {
          setError((prev) =>
            prev || (err instanceof Error ? err.message : "Failed to load telemetry.")
          );
        }
      } finally {
        if (!cancelled) setLoadingTelemetry(false);
      }
    }

    void loadTelemetry();
    const id = window.setInterval(loadTelemetry, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const sensorHealth = useMemo<SensorHealthRow[]>(() => {
    const STALE_MS = 15_000;

    return sensors.map((sensor) => {
      const latest = latestByDevice[sensor.id] ?? null;
      const latestTsMs = extractTimestampMs(latest);
      const isStale =
        latestTsMs == null || serverTime <= 0 ? true : serverTime - latestTsMs > STALE_MS;

      return {
        id: sensor.id,
        name: sensor.name,
        zoneLabel: sensor.zone_label,
        isActive: sensor.is_active,
        latestTsMs,
        isStale,
        rainMmHr: extractRainMmHr(latest),
        floodDepthCm: extractFloodDepthCm(latest),
        overflow: isOverflow(latest),
        batteryPercentage: extractBatteryPercentage(latest),
        rssiDbm: extractRssiDbm(latest),
      };
    });
  }, [sensors, latestByDevice, serverTime]);

  const counts = useMemo(() => {
    const total = sensors.length;
    const active = sensors.filter((s) => s.is_active).length;
    const inactive = total - active;

    const live = sensorHealth.filter((s) => !s.isStale).length;
    const stale = sensorHealth.filter((s) => s.isStale).length;
    const overflow = sensorHealth.filter((s) => s.overflow).length;
    const warningDepth = sensorHealth.filter((s) => s.floodDepthCm >= 20).length;

    const feedbackNew = feedback.filter((m) => m.status === "new").length;

    return {
      total,
      active,
      inactive,
      live,
      stale,
      overflow,
      warningDepth,
      feedbackNew,
    };
  }, [sensors, sensorHealth, feedback]);

  const loading = loadingSensors || loadingFeedback || loadingTelemetry;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Admin Control Center
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
              Admin Dashboard
            </h1>
            <div className="mt-2 max-w-3xl text-sm text-zinc-600">
              Monitor sensor health, review public feedback, and access the main
              operational tools for your flood-monitoring platform.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/admin/sensors" className={actionButtonClasses()}>
              Manage Sensors
            </Link>
            <Link href="/dashboard/admin/alerts" className={actionButtonClasses("primary")}>
              Open Alerts
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Sensors Total"
            value={loading ? "…" : counts.total}
            subtitle={`Active: ${counts.active} • Inactive: ${counts.inactive}`}
          />

          <StatCard
            title="Live Sensors"
            value={loading ? "…" : counts.live}
            tone={counts.stale > 0 ? "warn" : "ok"}
            subtitle={`Healthy live feed • Stale: ${counts.stale}`}
          />

          <StatCard
            title="Flood / Overflow Flags"
            value={loading ? "…" : counts.warningDepth}
            tone={counts.overflow > 0 || counts.warningDepth > 0 ? "bad" : "ok"}
            subtitle={`Depth ≥ 20 cm • Overflow: ${counts.overflow}`}
          />

          <StatCard
            title="New Feedback"
            value={loading ? "…" : counts.feedbackNew}
            tone={counts.feedbackNew > 0 ? "warn" : "ok"}
            subtitle="Unread public messages"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.85fr]">
          <Panel
            title="Sensor Health Overview"
            subtitle="Latest telemetry-backed operational status for each registered sensor."
            action={
              <Link
                href="/dashboard/admin/sensors"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Open Sensors
              </Link>
            }
          >
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Sensor</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Latest</th>
                    <th className="px-4 py-3 font-semibold">Rain</th>
                    <th className="px-4 py-3 font-semibold">Flood</th>
                    <th className="px-4 py-3 font-semibold">Overflow</th>
                    <th className="px-4 py-3 font-semibold">Battery</th>
                    <th className="px-4 py-3 font-semibold">RSSI</th>
                  </tr>
                </thead>
                <tbody>
                  {sensorHealth.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-sm text-zinc-500">
                        No sensors found.
                      </td>
                    </tr>
                  ) : (
                    sensorHealth.map((sensor) => {
                      const tone =
                        !sensor.isActive
                          ? "neutral"
                          : sensor.isStale
                          ? "warn"
                          : sensor.overflow || sensor.floodDepthCm >= 20
                          ? "bad"
                          : "ok";

                      const label = !sensor.isActive
                        ? "Inactive"
                        : sensor.isStale
                        ? "Stale"
                        : sensor.overflow || sensor.floodDepthCm >= 20
                        ? "Attention"
                        : "Live";

                      return (
                        <tr key={sensor.id} className="border-t border-zinc-100">
                          <td className="px-4 py-3 align-top">
                            <div className="font-bold text-zinc-900">{sensor.name}</div>
                            <div className="text-xs text-zinc-500">
                              {sensor.zoneLabel ?? "—"} • {sensor.id}
                            </div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusPillClasses(
                                tone
                              )}`}
                            >
                              {label}
                            </span>
                          </td>

                          <td className="px-4 py-3 align-top text-zinc-700">
                            {fmtTime(sensor.latestTsMs)}
                          </td>

                          <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                            {fmt(sensor.rainMmHr, 1)} mm/hr
                          </td>

                          <td className="px-4 py-3 align-top font-semibold text-zinc-900">
                            {fmt(sensor.floodDepthCm, 1)} cm
                          </td>

                          <td className="px-4 py-3 align-top">
                            {sensor.overflow ? (
                              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 ring-1 ring-red-200">
                                Yes
                              </span>
                            ) : (
                              <span className="text-zinc-500">No</span>
                            )}
                          </td>

                          <td className="px-4 py-3 align-top text-zinc-700">
                            {sensor.batteryPercentage != null
                              ? `${fmtInt(sensor.batteryPercentage)}%`
                              : "—"}
                          </td>

                          <td className="px-4 py-3 align-top text-zinc-700">
                            {sensor.rssiDbm != null ? `${fmtInt(sensor.rssiDbm)} dBm` : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              {sensorHealth.length === 0 ? (
                <div className="text-sm text-zinc-500">No sensors found.</div>
              ) : (
                sensorHealth.map((sensor) => {
                  const tone =
                    !sensor.isActive
                      ? "neutral"
                      : sensor.isStale
                      ? "warn"
                      : sensor.overflow || sensor.floodDepthCm >= 20
                      ? "bad"
                      : "ok";

                  const label = !sensor.isActive
                    ? "Inactive"
                    : sensor.isStale
                    ? "Stale"
                    : sensor.overflow || sensor.floodDepthCm >= 20
                    ? "Attention"
                    : "Live";

                  return (
                    <div
                      key={sensor.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-zinc-900">{sensor.name}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {sensor.zoneLabel ?? "—"} • {sensor.id}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusPillClasses(
                            tone
                          )}`}
                        >
                          {label}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            Latest
                          </div>
                          <div className="mt-1 text-zinc-800">
                            {fmtTime(sensor.latestTsMs)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            Rain
                          </div>
                          <div className="mt-1 font-semibold text-zinc-900">
                            {fmt(sensor.rainMmHr, 1)} mm/hr
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            Flood
                          </div>
                          <div className="mt-1 font-semibold text-zinc-900">
                            {fmt(sensor.floodDepthCm, 1)} cm
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            Overflow
                          </div>
                          <div className="mt-1 text-zinc-800">
                            {sensor.overflow ? "Yes" : "No"}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            Battery
                          </div>
                          <div className="mt-1 text-zinc-800">
                            {sensor.batteryPercentage != null
                              ? `${fmtInt(sensor.batteryPercentage)}%`
                              : "—"}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase text-zinc-500">
                            RSSI
                          </div>
                          <div className="mt-1 text-zinc-800">
                            {sensor.rssiDbm != null ? `${fmtInt(sensor.rssiDbm)} dBm` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4">
            <Panel
              title="Quick Actions"
              subtitle="Primary navigation for operations and monitoring."
            >
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 sm:p-5">
                <Link href="/dashboard/admin/sensors" className={actionButtonClasses()}>
                  Manage Sensors
                </Link>

                <Link href="/dashboard/admin/events" className={actionButtonClasses()}>
                  Open Rain Events
                </Link>

                <Link href="/dashboard/admin/alerts" className={actionButtonClasses()}>
                  Open Alerts
                </Link>

                <Link href="/dashboard/sensor" className={actionButtonClasses()}>
                  Open Sensor Dashboard
                </Link>

                <Link href="/dashboard" className={actionButtonClasses()}>
                  View Public Dashboard
                </Link>
              </div>
            </Panel>

            <Panel
              title="Recent Feedback"
              subtitle="Latest public messages submitted through the feedback widget."
            >
              <div className="max-h-[420px] overflow-y-auto">
                {feedback.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-zinc-500 sm:px-5">
                    No feedback messages yet.
                  </div>
                ) : (
                  feedback.map((message) => (
                    <div
                      key={message.id}
                      className="border-b border-zinc-100 px-4 py-4 last:border-b-0 sm:px-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-zinc-900">
                            {message.subject?.trim() || "No subject"}
                          </div>
                          <div className="mt-1 truncate text-xs text-zinc-500">
                            {message.name?.trim() || "Anonymous"}
                            {message.email ? ` • ${message.email}` : ""}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold ${feedbackStatusClasses(
                            message.status
                          )}`}
                        >
                          {message.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="mt-2 line-clamp-3 text-sm text-zinc-700">
                        {message.message}
                      </div>

                      <div className="mt-2 text-xs text-zinc-500">
                        {fmtTime(
                          message.created_at ? new Date(message.created_at).getTime() : null
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}