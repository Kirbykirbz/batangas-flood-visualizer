"use client";

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

type Props = {
  overview: OverviewItem[];
  overviewLoading: boolean;
  selectedDeviceId: string;
  actionBusyKey: string;
  overviewError: string;
  onChooseSensor: (item: OverviewItem) => void;
  onAcknowledgeAlert: (alertId: number) => void | Promise<void>;
  onResolveAlert: (alertId: number) => void | Promise<void>;
};

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

function floodLabelClasses(label: FloodCategory) {
  switch (label) {
    case "OVERFLOW":
      return "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-200";
    case "DANGER":
      return "bg-red-100 text-red-800 ring-1 ring-red-200";
    case "WARNING":
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    case "WATCH":
      return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }
}

function rainLabelClasses(label: RainCategory) {
  switch (label) {
    case "EXTREME":
      return "bg-red-100 text-red-800 ring-1 ring-red-200";
    case "VERY_HEAVY":
      return "bg-orange-100 text-orange-800 ring-1 ring-orange-200";
    case "HEAVY":
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    case "MODERATE":
      return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
    case "LIGHT":
      return "bg-sky-100 text-sky-800 ring-1 ring-sky-200";
    default:
      return "bg-zinc-100 text-zinc-800 ring-1 ring-zinc-200";
  }
}

export default function AlertsOverviewSection({
  overview,
  overviewLoading,
  selectedDeviceId,
  actionBusyKey,
  overviewError,
  onChooseSensor,
  onAcknowledgeAlert,
  onResolveAlert,
}: Props) {
  return (
    <>
      {overviewError ? (
        <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          {overviewError}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
          <div className="text-base font-extrabold text-zinc-900">
            Live Sensor Overview
          </div>
          <div className="mt-1 text-sm text-zinc-600">
            Tap a sensor card to prefill the push composer.
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {overviewLoading ? (
            <div className="text-sm text-zinc-500">Loading overview...</div>
          ) : overview.length === 0 ? (
            <div className="text-sm text-zinc-500">No active sensors found.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {overview.map((item) => {
                const selected = item.deviceId === selectedDeviceId;
                const openAlert = item.latestOpenAlert;

                return (
                  <div
                    key={item.deviceId}
                    role="button"
                    tabIndex={0}
                    onClick={() => onChooseSensor(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onChooseSensor(item);
                      }
                    }}
                    className={[
                      "cursor-pointer rounded-2xl border p-4 text-left shadow-sm transition",
                      selected
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className={`font-extrabold ${
                            selected ? "text-white" : "text-zinc-900"
                          }`}
                        >
                          {item.sensorName}
                        </div>
                        <div
                          className={`mt-1 text-xs ${
                            selected ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          {item.zoneLabel ?? item.deviceId}
                        </div>
                      </div>

                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          selected
                            ? "bg-white/15 text-white ring-1 ring-white/15"
                            : levelClasses(item.derivedLevel)
                        }`}
                      >
                        {(item.derivedLevel ?? "normal").toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div
                          className={`text-[11px] font-semibold uppercase ${
                            selected ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          Rain
                        </div>
                        <div
                          className={`mt-1 font-semibold ${
                            selected ? "text-white" : "text-zinc-900"
                          }`}
                        >
                          {fmt(item.rainRateMmh, 1)} mm/hr
                        </div>
                      </div>

                      <div>
                        <div
                          className={`text-[11px] font-semibold uppercase ${
                            selected ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          Flood
                        </div>
                        <div
                          className={`mt-1 font-semibold ${
                            selected ? "text-white" : "text-zinc-900"
                          }`}
                        >
                          {fmt(item.floodDepthCm, 1)} cm
                        </div>
                      </div>

                      <div>
                        <div
                          className={`text-[11px] font-semibold uppercase ${
                            selected ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          Flood Category
                        </div>
                        <div className="mt-1">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                              selected
                                ? "bg-white/15 text-white ring-1 ring-white/15"
                                : floodLabelClasses(item.floodCategory)
                            }`}
                          >
                            {item.floodCategory}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div
                          className={`text-[11px] font-semibold uppercase ${
                            selected ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          Rain Category
                        </div>
                        <div className="mt-1">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                              selected
                                ? "bg-white/15 text-white ring-1 ring-white/15"
                                : rainLabelClasses(item.rainCategory)
                            }`}
                          >
                            {item.rainCategory}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`mt-4 grid grid-cols-2 gap-3 text-xs ${
                        selected ? "text-zinc-300" : "text-zinc-600"
                      }`}
                    >
                      <div>Latest: {fmtTime(item.latestReadingAt)}</div>
                      <div>Overflow: {item.overflow ? "Yes" : "No"}</div>
                      <div>Sound: {soundLabel(item.soundKey)}</div>
                      <div>
                        Ongoing Event:{" "}
                        {item.ongoingRainEventId != null
                          ? item.ongoingRainEventId
                          : "—"}
                      </div>
                    </div>

                    {openAlert ? (
                      <div
                        className={`mt-4 rounded-xl p-3 text-xs ${
                          selected
                            ? "bg-white/10 text-zinc-100 ring-1 ring-white/10"
                            : "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200"
                        }`}
                      >
                        <div className="font-bold">
                          Open alert: {openAlert.title}
                        </div>
                        <div className="mt-1 line-clamp-2">
                          {openAlert.message}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={actionBusyKey === `ack-${openAlert.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onAcknowledgeAlert(openAlert.id);
                            }}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-bold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                          >
                            {actionBusyKey === `ack-${openAlert.id}`
                              ? "Acknowledging..."
                              : "Acknowledge"}
                          </button>
                          <button
                            type="button"
                            disabled={actionBusyKey === `res-${openAlert.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onResolveAlert(openAlert.id);
                            }}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                          >
                            {actionBusyKey === `res-${openAlert.id}`
                              ? "Resolving..."
                              : "Resolve"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}