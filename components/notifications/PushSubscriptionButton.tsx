"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export default function PushSubscriptionButton({
  deviceId,
}: {
  deviceId?: string | null;
}) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(isSupported);

    if (isSupported) {
      setPermission(Notification.permission);
    }
  }, []);

  async function handleSubscribe() {
    try {
      setBusy(true);
      setMessage("");

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
      }

      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;

      if (!registration.active) {
        throw new Error("Service worker is not active yet.");
      }

      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        setMessage("Notification permission was not granted.");
        return;
      }

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;

      if (!json.endpoint || !p256dh || !auth) {
        throw new Error("Subscription keys are incomplete.");
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh,
          auth,
          deviceId: deviceId ?? null,
          scope: "general",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          data?.error
            ? `Subscribe API failed: ${data.error}`
            : `Subscribe API failed with status ${res.status}`
        );
      }

      setMessage("Push notifications enabled for this browser.");
    } catch (err) {
      console.error("Enable push notifications failed:", err);
      setMessage(err instanceof Error ? err.message : "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="text-sm text-zinc-500">
        Push notifications are not supported in this browser.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={busy}
        className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
      >
        {busy
          ? "Enabling..."
          : permission === "granted"
          ? "Enable Push Again"
          : "Enable Push Notifications"}
      </button>

      {message && <div className="text-sm text-zinc-600">{message}</div>}
    </div>
  );
}