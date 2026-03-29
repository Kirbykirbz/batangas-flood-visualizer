"use client";

import { useMemo, useState } from "react";

type RestartDeviceButtonProps = {
  deviceId: string;
  disabled?: boolean;
  compact?: boolean;
  onQueued?: () => void;
};

type ActionState = "idle" | "success" | "error";

export default function RestartDeviceButton({
  deviceId,
  disabled = false,
  compact = false,
  onQueued,
}: RestartDeviceButtonProps) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");

  const buttonClasses = useMemo(() => {
    const base =
      "inline-flex items-center justify-center rounded-xl font-bold transition disabled:cursor-not-allowed disabled:opacity-50";
    const size = compact
      ? "px-3 py-2 text-xs"
      : "px-4 py-2 text-sm";
    const tone =
      "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100";

    return `${base} ${size} ${tone}`;
  }, [compact]);

  async function handleRestart() {
    if (disabled || busy) return;

    const confirmed = window.confirm(
      `Restart device "${deviceId}"?\n\nThis will queue a remote restart command for the ESP32.`
    );

    if (!confirmed) return;

    try {
      setBusy(true);
      setState("idle");
      setMessage("");

      const res = await fetch("/api/admin/devices/restart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId,
          notes: "Queued from admin dashboard",
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to queue restart command.");
      }

      setState("success");
      setMessage("Restart queued.");
      onQueued?.();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to queue restart command.";
      setState("error");
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleRestart}
        disabled={disabled || busy}
        className={buttonClasses}
      >
        {busy ? "Queuing..." : "Restart"}
      </button>

      {state === "success" ? (
        <span className="text-[11px] font-medium text-emerald-700">
          {message}
        </span>
      ) : null}

      {state === "error" ? (
        <span className="max-w-[220px] text-[11px] font-medium text-red-700">
          {message}
        </span>
      ) : null}
    </div>
  );
}