"use client";

import { useState } from "react";

export default function TestPushButton({
  deviceId,
}: {
  deviceId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handleTestPush() {
    try {
      setBusy(true);
      setMessage("");

      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Test Flood Alert",
          message: "This is a manual push test from the admin dashboard.",
          url: "/dashboard/admin/alerts",
          deviceId: deviceId ?? null,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          data?.error
            ? `Push test failed: ${data.error}`
            : `Push test failed with status ${res.status}`
        );
      }

      setMessage(
        `Push sent. Success: ${data?.sent ?? 0}, Failed: ${data?.failed ?? 0}`
      );
    } catch (err) {
      console.error("[TestPushButton] failed:", err);
      setMessage(err instanceof Error ? err.message : "Failed to send test push.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleTestPush}
        disabled={busy}
        className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
      >
        {busy ? "Sending..." : "Send Test Push"}
      </button>

      {message && <div className="text-sm text-zinc-600">{message}</div>}
    </div>
  );
}