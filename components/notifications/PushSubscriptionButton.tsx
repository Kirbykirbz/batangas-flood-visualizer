"use client";

import { useEffect, useRef, useState } from "react";

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

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 17H9m6 0H5.5c1.2-1 2-2.6 2-4.3V10a4.5 4.5 0 1 1 9 0v2.7c0 1.7.8 3.3 2 4.3H15Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      {active ? (
        <circle cx="18.5" cy="6" r="2.2" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}

type ToastState = {
  open: boolean;
  text: string;
  tone: "success" | "error";
};

export default function PushSubscriptionButton({
  deviceId,
}: {
  deviceId?: string | null;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [toast, setToast] = useState<ToastState>({
    open: false,
    text: "",
    tone: "success",
  });

  const toastTimerRef = useRef<number | null>(null);

  function showToast(text: string, tone: "success" | "error") {
    setToast({ open: true, text, tone });

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, open: false }));
    }, 2200);
  }

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(isSupported);

    if (!isSupported) return;

    void syncSubscriptionState();

    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  async function syncSubscriptionState() {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!registration) {
        setEnabled(false);
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      setEnabled(!!subscription && Notification.permission === "granted");
    } catch (err) {
      console.error("Failed to sync push subscription state:", err);
      setEnabled(false);
    }
  }

  async function subscribe() {
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

    if (nextPermission !== "granted") {
      setEnabled(false);
      showToast("Notification permission was not granted.", "error");
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
        scope: deviceId ? "device" : "all",
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(
        data?.error
          ? `Subscribe failed: ${data.error}`
          : `Subscribe failed with status ${res.status}`
      );
    }

    setEnabled(true);
    showToast("Notifications enabled.", "success");
  }

  async function unsubscribe() {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;

    if (!subscription) {
      setEnabled(false);
      showToast("Notifications already disabled.", "success");
      return;
    }

    const endpoint = subscription.endpoint;

    const res = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(
        data?.error
          ? `Unsubscribe failed: ${data.error}`
          : `Unsubscribe failed with status ${res.status}`
      );
    }

    await subscription.unsubscribe();

    setEnabled(false);
    showToast("Notifications disabled.", "success");
  }

  async function handleToggle() {
    try {
      setBusy(true);

      if (enabled) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (err) {
      console.error("Push toggle failed:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to update notifications.",
        "error"
      );
      await syncSubscriptionState();
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        aria-label={enabled ? "Disable notifications" : "Enable notifications"}
        title={
          busy
            ? "Updating notification preference..."
            : enabled
            ? "Notifications enabled"
            : "Notifications disabled"
        }
        className={[
          "relative inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-sm transition",
          "disabled:cursor-not-allowed disabled:opacity-60",
          enabled
            ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
        ].join(" ")}
      >
        <BellIcon active={enabled} />
      </button>

      {toast.open ? (
        <div
          className={[
            "absolute right-0 top-14 z-[3500] min-w-[190px] rounded-xl px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur",
            toast.tone === "success"
              ? "bg-zinc-900 text-white ring-zinc-800"
              : "bg-red-50 text-red-700 ring-red-200",
          ].join(" ")}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}