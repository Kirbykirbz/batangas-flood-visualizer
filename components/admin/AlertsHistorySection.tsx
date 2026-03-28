"use client";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";

type OverviewItem = {
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;
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

type Props = {
  history: HistoryItem[];
  historyLoading: boolean;
  historyError: string;
  historyDeviceId: string;
  historyLevel: AlertLevel | "all";
  historyOpenOnly: boolean;
  historyAcknowledged: "all" | "true" | "false";
  historyLimit: number;
  historyLimitOptions: number[];
  overview: OverviewItem[];
  actionBusyKey: string;
  onHistoryDeviceIdChange: (value: string) => void;
  onHistoryLevelChange: (value: AlertLevel | "all") => void;
  onHistoryOpenOnlyChange: (value: boolean) => void;
  onHistoryAcknowledgedChange: (value: "all" | "true" | "false") => void;
  onHistoryLimitChange: (value: number) => void;
  onAcknowledgeAlert: (alertId: number) => void | Promise<void>;
  onResolveAlert: (alertId: number) => void | Promise<void>;
};

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function compactDuration(fromIso: string | null) {
  if (!fromIso) return "—";
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - from) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
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

export default function AlertsHistorySection({
  history,
  historyLoading,
  historyError,
  historyDeviceId,
  historyLevel,
  historyOpenOnly,
  historyAcknowledged,
  historyLimit,
  historyLimitOptions,
  overview,
  actionBusyKey,
  onHistoryDeviceIdChange,
  onHistoryLevelChange,
  onHistoryOpenOnlyChange,
  onHistoryAcknowledgedChange,
  onHistoryLimitChange,
  onAcknowledgeAlert,
  onResolveAlert,
}: Props) {
  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
        <div className="text-base font-extrabold text-zinc-900">
          Alert History
        </div>
        <div className="mt-1 text-sm text-zinc-600">
          Review historical alerts and manage open ones.
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Sensor
            </label>
            <select
              value={historyDeviceId}
              onChange={(e) => onHistoryDeviceIdChange(e.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
            >
              <option value="all">All sensors</option>
              {overview.map((item) => (
                <option key={item.deviceId} value={item.deviceId}>
                  {item.sensorName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Level
            </label>
            <select
              value={historyLevel}
              onChange={(e) =>
                onHistoryLevelChange(e.target.value as AlertLevel | "all")
              }
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
            >
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="watch">Watch</option>
              <option value="warning">Warning</option>
              <option value="danger">Danger</option>
              <option value="overflow">Overflow</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Acknowledged
            </label>
            <select
              value={historyAcknowledged}
              onChange={(e) =>
                onHistoryAcknowledgedChange(
                  e.target.value as "all" | "true" | "false"
                )
              }
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
            >
              <option value="all">All</option>
              <option value="true">Acknowledged</option>
              <option value="false">Unacknowledged</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Rows
            </label>
            <select
              value={historyLimit}
              onChange={(e) => onHistoryLimitChange(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
            >
              {historyLimitOptions.map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={historyOpenOnly}
                onChange={(e) => onHistoryOpenOnlyChange(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span>Open only</span>
            </label>
          </div>
        </div>

        {historyError ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            {historyError}
          </div>
        ) : null}

        <div className="block lg:hidden">
          {historyLoading ? (
            <div className="text-sm text-zinc-500">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-zinc-500">No alerts found.</div>
          ) : (
            <div className="space-y-3">
              {history.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-extrabold text-zinc-900">
                        {row.sensorName}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {row.zoneLabel ?? row.deviceId}
                      </div>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${levelClasses(
                        row.level
                      )}`}
                    >
                      {row.level.toUpperCase()}
                    </span>
                  </div>

                  <div className="mt-3 text-sm font-semibold text-zinc-900">
                    {row.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-zinc-700">
                    {row.message}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-600">
                    <div>Triggered: {fmtTime(row.triggeredAt)}</div>
                    <div>Age: {compactDuration(row.triggeredAt)}</div>
                    <div>Resolved: {fmtTime(row.resolvedAt)}</div>
                    <div>Acknowledged: {row.acknowledged ? "Yes" : "No"}</div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {!row.acknowledged ? (
                      <button
                        type="button"
                        disabled={actionBusyKey === `ack-${row.id}`}
                        onClick={() => void onAcknowledgeAlert(row.id)}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {actionBusyKey === `ack-${row.id}`
                          ? "Acknowledging..."
                          : "Acknowledge"}
                      </button>
                    ) : null}

                    {!row.resolvedAt ? (
                      <button
                        type="button"
                        disabled={actionBusyKey === `res-${row.id}`}
                        onClick={() => void onResolveAlert(row.id)}
                        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                      >
                        {actionBusyKey === `res-${row.id}`
                          ? "Resolving..."
                          : "Resolve"}
                      </button>
                    ) : null}
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
                <th className="px-4 py-3 font-semibold">Level</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Triggered</th>
                <th className="px-4 py-3 font-semibold">Resolved</th>
                <th className="px-4 py-3 font-semibold">Ack</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-sm text-zinc-500">
                    Loading history...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-sm text-zinc-500">
                    No alerts found.
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-zinc-900">
                        {row.sensorName}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {row.zoneLabel ?? row.deviceId}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${levelClasses(
                          row.level
                        )}`}
                      >
                        {row.level.toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">
                        {row.title}
                      </div>
                      <div className="mt-1 max-w-md text-xs leading-5 text-zinc-600">
                        {row.message}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-zinc-700">
                      <div>{fmtTime(row.triggeredAt)}</div>
                      <div className="text-xs text-zinc-500">
                        {compactDuration(row.triggeredAt)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-zinc-700">
                      {fmtTime(row.resolvedAt)}
                    </td>

                    <td className="px-4 py-3 text-zinc-700">
                      {row.acknowledged ? "Yes" : "No"}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {!row.acknowledged ? (
                          <button
                            type="button"
                            disabled={actionBusyKey === `ack-${row.id}`}
                            onClick={() => void onAcknowledgeAlert(row.id)}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                          >
                            {actionBusyKey === `ack-${row.id}`
                              ? "Acknowledging..."
                              : "Acknowledge"}
                          </button>
                        ) : null}

                        {!row.resolvedAt ? (
                          <button
                            type="button"
                            disabled={actionBusyKey === `res-${row.id}`}
                            onClick={() => void onResolveAlert(row.id)}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                          >
                            {actionBusyKey === `res-${row.id}`
                              ? "Resolving..."
                              : "Resolve"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}