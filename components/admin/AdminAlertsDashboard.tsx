"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AlertsOverviewSection from "@/components/admin/AlertsOverviewSection";
import AlertsHistorySection from "@/components/admin/AlertsHistorySection";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
type DerivedAlertLevel = "watch" | "warning" | "danger" | "overflow" | null;
type FloodCategory = "NORMAL" | "WATCH" | "WARNING" | "DANGER" | "OVERFLOW";
type RainCategory =
  | "NONE"
  | "LIGHT"
  | "MODERATE"
  | "HEAVY"
  | "VERY_HEAVY"
  | "EXTREME";
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

type OverviewItem = {
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;
  latestReadingAt: string | null;
  rainRateMmh: number | null;
  floodDepthCm: number | null;
  overflow: boolean;
  floodCategory: FloodCategory;
  rainCategory: RainCategory;
  derivedLevel: DerivedAlertLevel;
  soundKey: SoundKey;
  ongoingRainEventId: number | null;
  latestOpenAlert: {
    id: number;
    level: AlertLevel;
    title: string;
    message: string;
    triggeredAt: string;
    acknowledged: boolean;
  } | null;
};

type OverviewResponse =
  | {
      ok: true;
      items: OverviewItem[];
      serverTime: string;
    }
  | {
      ok: false;
      error: string;
    };

type HistoryItem = {
  id: number;
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;
  rainEventId: number | null;
  level: AlertLevel;
  title: string;
  message: string;
  triggeredAt: string;
  resolvedAt: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

type HistoryResponse =
  | {
      ok: true;
      items: HistoryItem[];
    }
  | {
      ok: false;
      error: string;
    };

type SendResponse =
  | {
      ok: true;
      sent: number;
      failed: number;
      createdAlertId?: number | null;
      title: string;
      message: string;
      url: string;
    }
  | {
      ok: false;
      error: string;
    };

type ActionResponse =
  | { ok: true }
  | { ok: false; error: string };

type ComposerState = {
  targetMode: "all" | "device";
  deviceId: string;
  level: AlertLevel;
  title: string;
  message: string;
  url: string;
  createHistory: boolean;
};

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function soundLabel(soundKey: SoundKey) {
  switch (soundKey) {
    case "warning-soft":
      return "warning-soft.mp3";
    case "danger-alarm":
      return "danger-alarm.mp3";
    case "overflow-alarm":
      return "overflow-alarm.mp3";
    default:
      return "None";
  }
}

function levelClasses(level: string | null | undefined) {
  switch (level) {
    case "overflow":
      return "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-200";
    case "danger":
      return "bg-red-100 text-red-800 ring-1 ring-red-200";
    case "warning":
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    case "watch":
      return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
    case "info":
      return "bg-zinc-100 text-zinc-800 ring-1 ring-zinc-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }
}

function buildDefaultText(
  level: AlertLevel,
  sensorName?: string,
  zoneLabel?: string | null
) {
  const place = zoneLabel?.trim() ? ` in ${zoneLabel}` : "";
  const name = sensorName?.trim() || "the monitored area";

  switch (level) {
    case "watch":
      return {
        title: `Flood watch advisory for ${name}`,
        message: `Watch conditions have been detected for ${name}${place}. Please stay alert and continue monitoring updates.`,
      };
    case "warning":
      return {
        title: `Flood warning advisory for ${name}`,
        message: `Warning conditions have been detected for ${name}${place}. Prepare for possible flooding and monitor updates closely.`,
      };
    case "danger":
      return {
        title: `Danger flood alert for ${name}`,
        message: `Danger conditions have been detected for ${name}${place}. Take safety precautions immediately and avoid flood-prone areas.`,
      };
    case "overflow":
      return {
        title: `Overflow critical alert for ${name}`,
        message: `Overflow or near-sensor critical water condition has been detected for ${name}${place}. Immediate attention is advised.`,
      };
    case "info":
    default:
      return {
        title: `Flood monitoring update for ${name}`,
        message: `A flood monitoring update has been issued for ${name}${place}. Please check the dashboard for details.`,
      };
  }
}

const HISTORY_LIMIT_OPTIONS = [20, 50, 100];

export default function AdminAlertsDashboard() {
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [historyDeviceId, setHistoryDeviceId] = useState("all");
  const [historyLevel, setHistoryLevel] = useState<AlertLevel | "all">("all");
  const [historyOpenOnly, setHistoryOpenOnly] = useState(false);
  const [historyAcknowledged, setHistoryAcknowledged] = useState<
    "all" | "true" | "false"
  >("all");
  const [historyLimit, setHistoryLimit] = useState(20);

  const [composer, setComposer] = useState<ComposerState>({
    targetMode: "all",
    deviceId: "",
    level: "info",
    title: buildDefaultText("info").title,
    message: buildDefaultText("info").message,
    url: "/dashboard",
    createHistory: false,
  });

  const [sendBusy, setSendBusy] = useState(false);
  const [sendFeedback, setSendFeedback] = useState("");
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [actionError, setActionError] = useState("");

  const overviewRequestInFlightRef = useRef(false);
  const historyRequestInFlightRef = useRef(false);
  const hasLoadedOverviewOnceRef = useRef(false);
  const hasLoadedHistoryOnceRef = useRef(false);

  const selectedSensor = useMemo(
    () => overview.find((x) => x.deviceId === selectedDeviceId) ?? null,
    [overview, selectedDeviceId]
  );

  function getSensorById(deviceId: string) {
    return overview.find((x) => x.deviceId === deviceId) ?? null;
  }

  function buildComposerDefaults(
    level: AlertLevel,
    targetMode: "all" | "device",
    deviceId: string
  ) {
    const sensor = targetMode === "device" && deviceId ? getSensorById(deviceId) : null;
    const defaults = buildDefaultText(level, sensor?.sensorName, sensor?.zoneLabel ?? null);

    return {
      title: defaults.title,
      message: defaults.message,
      url:
        targetMode === "device" && deviceId
          ? `/dashboard?sensor=${encodeURIComponent(deviceId)}`
          : "/dashboard",
    };
  }

  function patchComposer(patch: Partial<ComposerState>) {
    setComposer((prev) => ({ ...prev, ...patch }));
  }

  function clearActionMessages() {
    setActionFeedback("");
    setActionError("");
  }

  function handleComposerTargetModeChange(targetMode: "all" | "device") {
    setComposer((prev) => {
      const nextDeviceId =
        targetMode === "device" ? prev.deviceId || selectedDeviceId || "" : "";
      const defaults = buildComposerDefaults(prev.level, targetMode, nextDeviceId);

      return {
        ...prev,
        targetMode,
        deviceId: nextDeviceId,
        createHistory: targetMode === "device" ? prev.createHistory : false,
        title: defaults.title,
        message: defaults.message,
        url: defaults.url,
      };
    });
  }

  function handleComposerLevelChange(level: AlertLevel) {
    setComposer((prev) => {
      const defaults = buildComposerDefaults(prev.level, prev.targetMode, prev.deviceId);
      const titleWasDefault = prev.title.trim() === defaults.title;
      const messageWasDefault = prev.message.trim() === defaults.message;

      const nextDefaults = buildComposerDefaults(level, prev.targetMode, prev.deviceId);

      return {
        ...prev,
        level,
        title: titleWasDefault ? nextDefaults.title : prev.title,
        message: messageWasDefault ? nextDefaults.message : prev.message,
        url: prev.url,
      };
    });
  }

  function handleComposerDeviceChange(deviceId: string) {
    setSelectedDeviceId(deviceId);

    setComposer((prev) => {
      const defaults = buildComposerDefaults(prev.level, "device", deviceId);

      return {
        ...prev,
        targetMode: "device",
        deviceId,
        title: defaults.title,
        message: defaults.message,
        url: defaults.url,
      };
    });
  }

  async function loadOverview(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (overviewRequestInFlightRef.current) return;
    overviewRequestInFlightRef.current = true;

    try {
      if (!hasLoadedOverviewOnceRef.current) {
        setOverviewLoading(true);
      } else if (!silent) {
        setOverviewRefreshing(true);
      }

      const res = await fetch("/api/admin/alerts/overview", {
        cache: "no-store",
      });
      const json = (await res.json()) as OverviewResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to load overview." : json.error);
      }

      setOverview((prev) => {
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(json.items);
        return prevJson === nextJson ? prev : json.items;
      });

      setOverviewError("");
      hasLoadedOverviewOnceRef.current = true;

      setSelectedDeviceId((prev) => {
        if (prev && json.items.some((x) => x.deviceId === prev)) return prev;
        return json.items[0]?.deviceId ?? "";
      });
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : "Failed to load overview."
      );
    } finally {
      setOverviewLoading(false);
      setOverviewRefreshing(false);
      overviewRequestInFlightRef.current = false;
    }
  }

  async function loadHistory(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (historyRequestInFlightRef.current) return;
    historyRequestInFlightRef.current = true;

    try {
      if (!hasLoadedHistoryOnceRef.current) {
        setHistoryLoading(true);
      } else if (!silent) {
        setHistoryRefreshing(true);
      }

      const params = new URLSearchParams();
      params.set("limit", String(historyLimit));

      if (historyDeviceId !== "all") params.set("deviceId", historyDeviceId);
      if (historyLevel !== "all") params.set("level", historyLevel);
      if (historyOpenOnly) params.set("openOnly", "true");
      if (historyAcknowledged !== "all") {
        params.set("acknowledged", historyAcknowledged);
      }

      const res = await fetch(`/api/admin/alerts/history?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as HistoryResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to load history." : json.error);
      }

      setHistory((prev) => {
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(json.items);
        return prevJson === nextJson ? prev : json.items;
      });

      setHistoryError("");
      hasLoadedHistoryOnceRef.current = true;
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Failed to load history."
      );
    } finally {
      setHistoryLoading(false);
      setHistoryRefreshing(false);
      historyRequestInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void loadOverview();

    const run = () => {
      if (document.visibilityState !== "visible") return;
      void loadOverview({ silent: true });
    };

    const id = window.setInterval(run, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadOverview({ silent: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    void loadHistory({ silent: hasLoadedHistoryOnceRef.current });
  }, [
    historyDeviceId,
    historyLevel,
    historyOpenOnly,
    historyAcknowledged,
    historyLimit,
  ]);

  function handleChooseSensor(item: OverviewItem) {
    setSelectedDeviceId(item.deviceId);

    const preferredLevel: AlertLevel = item.derivedLevel ?? "info";
    const defaults = buildComposerDefaults(preferredLevel, "device", item.deviceId);

    setComposer({
      targetMode: "device",
      deviceId: item.deviceId,
      level: preferredLevel,
      title: defaults.title,
      message: defaults.message,
      url: defaults.url,
      createHistory: true,
    });
  }

  function applyDefaultMessage() {
    const defaults = buildComposerDefaults(
      composer.level,
      composer.targetMode,
      composer.deviceId
    );

    setComposer((prev) => ({
      ...prev,
      title: defaults.title,
      message: defaults.message,
      url: defaults.url,
    }));
  }

  async function sendManualAlert() {
    try {
      setSendBusy(true);
      setSendFeedback("");
      clearActionMessages();

      if (composer.targetMode === "device" && !composer.deviceId) {
        throw new Error("Select a sensor for device-targeted push.");
      }

      const res = await fetch("/api/admin/alerts/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetMode: composer.targetMode,
          deviceId: composer.targetMode === "device" ? composer.deviceId : null,
          level: composer.level,
          title: composer.title,
          message: composer.message,
          url: composer.url,
          createHistory:
            composer.targetMode === "device" ? composer.createHistory : false,
        }),
      });

      const json = (await res.json()) as SendResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to send alert." : json.error);
      }

      setSendFeedback(
        `Manual push sent successfully. Notification bar delivery attempted for subscribed users. Foreground in-webapp sound will also trigger for active users when supported. Delivered: ${json.sent}, Failed: ${json.failed}${
          json.createdAlertId ? `, Alert ID: ${json.createdAlertId}` : ""
        }`
      );

      await Promise.all([
        loadOverview({ silent: true }),
        loadHistory({ silent: true }),
      ]);
    } catch (err) {
      setSendFeedback(
        err instanceof Error ? err.message : "Failed to send alert."
      );
    } finally {
      setSendBusy(false);
    }
  }

  async function acknowledgeAlert(alertId: number) {
    try {
      setActionBusyKey(`ack-${alertId}`);
      clearActionMessages();

      const res = await fetch(`/api/admin/alerts/${alertId}/acknowledge`, {
        method: "POST",
      });
      const json = (await res.json()) as ActionResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to acknowledge alert." : json.error);
      }

      setActionFeedback(`Alert #${alertId} acknowledged successfully.`);

      await Promise.all([
        loadOverview({ silent: true }),
        loadHistory({ silent: true }),
      ]);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to acknowledge alert."
      );
    } finally {
      setActionBusyKey("");
    }
  }

  async function resolveAlert(alertId: number) {
    try {
      setActionBusyKey(`res-${alertId}`);
      clearActionMessages();

      const res = await fetch(`/api/admin/alerts/${alertId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ActionResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to resolve alert." : json.error);
      }

      setActionFeedback(`Alert #${alertId} resolved successfully.`);

      await Promise.all([
        loadOverview({ silent: true }),
        loadHistory({ silent: true }),
      ]);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to resolve alert."
      );
    } finally {
      setActionBusyKey("");
    }
  }

  const counts = useMemo(() => {
    const active = overview.filter((x) => x.derivedLevel != null).length;
    const openAlerts = overview.filter((x) => x.latestOpenAlert != null).length;
    const overflow = overview.filter((x) => x.derivedLevel === "overflow").length;
    const danger = overview.filter((x) => x.derivedLevel === "danger").length;

    return {
      sensors: overview.length,
      active,
      openAlerts,
      overflow,
      danger,
    };
  }, [overview]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-4 sm:py-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Admin Operations
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
              Alerts Dashboard
            </h1>
            <div className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
              Monitor live alert conditions, send customizable manual push
              notifications, and review alert history. Manual push can trigger
              both notification bar alerts and in-webapp alert sound when the
              user has the app open.
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              {overviewRefreshing || historyRefreshing
                ? "Refreshing data..."
                : "Live data active"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadOverview({ silent: false })}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Refresh Overview
            </button>
            <button
              type="button"
              onClick={() => void loadHistory({ silent: false })}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Refresh History
            </button>
          </div>
        </div>

        {actionFeedback ? (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {actionFeedback}
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            {actionError}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Sensors
            </div>
            <div className="mt-2 text-2xl font-extrabold text-zinc-900">
              {overviewLoading ? "…" : counts.sensors}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Active Levels
            </div>
            <div className="mt-2 text-2xl font-extrabold text-zinc-900">
              {overviewLoading ? "…" : counts.active}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Open Alerts
            </div>
            <div className="mt-2 text-2xl font-extrabold text-zinc-900">
              {overviewLoading ? "…" : counts.openAlerts}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Danger
            </div>
            <div className="mt-2 text-2xl font-extrabold text-red-700">
              {overviewLoading ? "…" : counts.danger}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Overflow
            </div>
            <div className="mt-2 text-2xl font-extrabold text-fuchsia-700">
              {overviewLoading ? "…" : counts.overflow}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.95fr]">
          <AlertsOverviewSection
            overview={overview}
            overviewLoading={overviewLoading}
            selectedDeviceId={selectedDeviceId}
            actionBusyKey={actionBusyKey}
            overviewError={overviewError}
            onChooseSensor={handleChooseSensor}
            onAcknowledgeAlert={acknowledgeAlert}
            onResolveAlert={resolveAlert}
          />

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
              <div className="text-base font-extrabold text-zinc-900">
                Manual Alert Composer
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                Customize title, message, target, and destination URL. Manual
                push sends a notification bar alert, and can also trigger
                in-webapp alert sound while the user is active in the tab or
                installed PWA.
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Target Mode
                  </label>
                  <select
                    value={composer.targetMode}
                    onChange={(e) =>
                      handleComposerTargetModeChange(
                        e.target.value as "all" | "device"
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
                  >
                    <option value="all">All Sensors</option>
                    <option value="device">Specific Sensor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Level
                  </label>
                  <select
                    value={composer.level}
                    onChange={(e) =>
                      handleComposerLevelChange(e.target.value as AlertLevel)
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
                  >
                    <option value="info">Info</option>
                    <option value="watch">Watch</option>
                    <option value="warning">Warning</option>
                    <option value="danger">Danger</option>
                    <option value="overflow">Overflow</option>
                  </select>
                </div>
              </div>

              {composer.targetMode === "device" ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Sensor
                  </label>
                  <select
                    value={composer.deviceId}
                    onChange={(e) => handleComposerDeviceChange(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
                  >
                    <option value="">Select sensor</option>
                    {overview.map((item) => (
                      <option key={item.deviceId} value={item.deviceId}>
                        {item.sensorName} — {item.zoneLabel ?? item.deviceId}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Title
                </label>
                <input
                  type="text"
                  value={composer.title}
                  onChange={(e) => patchComposer({ title: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm outline-none"
                  placeholder="Push notification title"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Message
                </label>
                <textarea
                  value={composer.message}
                  onChange={(e) => patchComposer({ message: e.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none"
                  placeholder="Push notification message"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  URL
                </label>
                <input
                  type="text"
                  value={composer.url}
                  onChange={(e) => patchComposer({ url: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm outline-none"
                  placeholder="/dashboard"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={composer.createHistory}
                    disabled={composer.targetMode !== "device"}
                    onChange={(e) =>
                      patchComposer({ createHistory: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>Create history row</span>
                </label>

                <button
                  type="button"
                  onClick={applyDefaultMessage}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
                >
                  Reset Default Text
                </button>
              </div>

              <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Delivery Preview
                </div>
                <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200">
                  <div className="text-sm font-extrabold text-zinc-900">
                    {composer.title || "Untitled notification"}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-zinc-700">
                    {composer.message || "No message"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-1 font-bold ${levelClasses(
                        composer.level
                      )}`}
                    >
                      {composer.level.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-bold text-zinc-700 ring-1 ring-zinc-200">
                      {composer.targetMode === "device"
                        ? composer.deviceId || "No sensor selected"
                        : "All sensors"}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-bold text-zinc-700 ring-1 ring-zinc-200">
                      URL: {composer.url || "/dashboard"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-600 sm:grid-cols-2">
                    <div className="rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200">
                      Notification bar alert with system notification sound and
                      vibration when supported.
                    </div>
                    <div className="rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200">
                      In-webapp alert sound when the user has the tab or
                      installed PWA open and foreground audio is enabled.
                    </div>
                  </div>
                </div>
              </div>

              {sendFeedback ? (
                <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700 ring-1 ring-zinc-200">
                  {sendFeedback}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void sendManualAlert()}
                disabled={sendBusy}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {sendBusy ? "Sending Alert..." : "Send Manual Alert"}
              </button>

              {selectedSensor ? (
                <div className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-700">
                  <div className="font-extrabold text-zinc-900">
                    Selected Sensor Alert Context
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>Sensor: {selectedSensor.sensorName}</div>
                    <div>Zone: {selectedSensor.zoneLabel ?? "—"}</div>
                    <div>Rain: {fmt(selectedSensor.rainRateMmh, 1)} mm/hr</div>
                    <div>Flood: {fmt(selectedSensor.floodDepthCm, 1)} cm</div>
                    <div>Derived: {selectedSensor.derivedLevel ?? "normal"}</div>
                    <div>Sound: {soundLabel(selectedSensor.soundKey)}</div>
                  </div>
                  <div className="mt-3 text-xs text-zinc-500">
                    Push uses the composed message. Foreground sound follows the
                    alert level and current sound mapping.
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <AlertsHistorySection
          history={history}
          historyLoading={historyLoading}
          historyError={historyError}
          historyDeviceId={historyDeviceId}
          historyLevel={historyLevel}
          historyOpenOnly={historyOpenOnly}
          historyAcknowledged={historyAcknowledged}
          historyLimit={historyLimit}
          historyLimitOptions={HISTORY_LIMIT_OPTIONS}
          overview={overview.map((item) => ({
            deviceId: item.deviceId,
            sensorName: item.sensorName,
            zoneLabel: item.zoneLabel,
          }))}
          actionBusyKey={actionBusyKey}
          onHistoryDeviceIdChange={setHistoryDeviceId}
          onHistoryLevelChange={setHistoryLevel}
          onHistoryOpenOnlyChange={setHistoryOpenOnly}
          onHistoryAcknowledgedChange={setHistoryAcknowledged}
          onHistoryLimitChange={setHistoryLimit}
          onAcknowledgeAlert={acknowledgeAlert}
          onResolveAlert={resolveAlert}
        />
      </div>
    </div>
  );
}