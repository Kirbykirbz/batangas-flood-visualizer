"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SubscriptionScope = "all" | "device";

type ToastState = {
  open: boolean;
  text: string;
  tone: "success" | "error";
};

type PublicSensorItem = {
  id: string;
  name: string;
  zoneLabel: string | null;
};

type PublicSensorsResponse =
  | {
      ok: true;
      sensors: PublicSensorItem[];
    }
  | {
      ok: false;
      error: string;
    };

type PushStatusResponse =
  | {
      ok: true;
      subscription: {
        isActive: boolean;
        scope: SubscriptionScope;
        targetDeviceIds: string[];
      } | null;
    }
  | {
      ok: false;
      error: string;
    };

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

export default function PushSubscriptionButton() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const [scope, setScope] = useState<SubscriptionScope>("all");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [sensors, setSensors] = useState<PublicSensorItem[]>([]);

  const [toast, setToast] = useState<ToastState>({
    open: false,
    text: "",
    tone: "success",
  });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  function showToast(text: string, tone: "success" | "error") {
    setToast({ open: true, text, tone });

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, open: false }));
    }, 2400);
  }

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(isSupported);

    if (!isSupported) return;

    void Promise.all([loadSensors(), syncSubscriptionState()]);

    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }

    if (panelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [panelOpen]);

  async function loadSensors() {
    try {
      const res = await fetch("/api/sensors/public", {
        cache: "no-store",
      });

      const json = (await res.json()) as PublicSensorsResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to load sensors." : json.error);
      }

      setSensors(json.sensors);
    } catch (err) {
      console.error("Failed to load sensors for notification selector:", err);
    }
  }

  async function getCurrentBrowserSubscription() {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return null;
    return registration.pushManager.getSubscription();
  }

  async function syncSubscriptionState() {
    try {
      const subscription = await getCurrentBrowserSubscription();

      if (!subscription || Notification.permission !== "granted") {
        setEnabled(false);
        setScope("all");
        setSelectedDeviceIds([]);
        return;
      }

      const res = await fetch("/api/push/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
        }),
      });

      const json = (await res.json()) as PushStatusResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.ok ? "Failed to load subscription status." : json.error);
      }

      const current = json.subscription;

      setEnabled(Boolean(current?.isActive));

      if (current?.scope === "device") {
        setScope("device");
        setSelectedDeviceIds(current.targetDeviceIds);
      } else {
        setScope("all");
        setSelectedDeviceIds([]);
      }
    } catch (err) {
      console.error("Failed to sync push subscription state:", err);
      setEnabled(false);
    }
  }

  async function ensureServiceWorkerAndPermission() {
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
      throw new Error("Notification permission was not granted.");
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

    return {
      endpoint: json.endpoint,
      p256dh,
      auth,
    };
  }

  async function subscribeSelected() {
    if (scope === "device" && selectedDeviceIds.length === 0) {
      throw new Error("Please select at least one sensor.");
    }

    const sub = await ensureServiceWorkerAndPermission();

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        scope,
        targetDeviceIds: scope === "device" ? selectedDeviceIds : [],
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
    setPanelOpen(false);

    showToast(
      scope === "device"
        ? "Notifications enabled for selected sensors."
        : "Notifications enabled for all sensors.",
      "success"
    );

    await syncSubscriptionState();
  }

  async function unsubscribeCurrent() {
    const subscription = await getCurrentBrowserSubscription();

    if (!subscription) {
      setEnabled(false);
      setScope("all");
      setSelectedDeviceIds([]);
      showToast("Notifications already disabled.", "success");
      return;
    }

    const res = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
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
    setScope("all");
    setSelectedDeviceIds([]);
    setPanelOpen(false);

    showToast("Notifications disabled.", "success");
  }

  async function handlePrimaryAction() {
    try {
      setBusy(true);

      if (enabled) {
        await unsubscribeCurrent();
      } else {
        setPanelOpen((prev) => !prev);
      }
    } catch (err) {
      console.error("Push notification action failed:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to update notifications.",
        "error"
      );
      await syncSubscriptionState();
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSubscribe() {
    try {
      setBusy(true);
      await subscribeSelected();
    } catch (err) {
      console.error("Push subscribe failed:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to subscribe.",
        "error"
      );
      await syncSubscriptionState();
    } finally {
      setBusy(false);
    }
  }

  function toggleDevice(deviceId: string) {
    setSelectedDeviceIds((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    );
  }

  const selectedSummary = useMemo(() => {
    if (scope === "all") return "All sensors";
    if (selectedDeviceIds.length === 0) return "No sensors selected";
    return `${selectedDeviceIds.length} sensor${
      selectedDeviceIds.length > 1 ? "s" : ""
    } selected`;
  }, [scope, selectedDeviceIds]);

  if (!supported) {
    return null;
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => void handlePrimaryAction()}
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

      {panelOpen && !enabled ? (
        <div className="absolute right-0 top-14 z-[3500] w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
          <div className="border-b border-zinc-200 px-4 py-3">
            <div className="text-sm font-extrabold text-zinc-900">
              Notification Subscription
            </div>
            <div className="mt-1 text-xs leading-5 text-zinc-500">
              Allow permission so alerts can reach the notification bar in the
              background. Choose all sensors or select one or more sensors.
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Subscription Scope
              </label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as SubscriptionScope)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm"
              >
                <option value="all">All sensors</option>
                <option value="device">Selected sensors</option>
              </select>
            </div>

            {scope === "device" ? (
              <div>
                <div className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Sensors
                </div>
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-zinc-200 p-2">
                  {sensors.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-zinc-500">
                      No sensors available.
                    </div>
                  ) : (
                    sensors.map((sensor) => {
                      const checked = selectedDeviceIds.includes(sensor.id);

                      return (
                        <label
                          key={sensor.id}
                          className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-zinc-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDevice(sensor.id)}
                            className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900">
                              {sensor.name}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {sensor.zoneLabel ?? sensor.id}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-600 ring-1 ring-zinc-200">
              {selectedSummary}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSubscribe()}
                disabled={busy || (scope === "device" && selectedDeviceIds.length === 0)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {busy ? "Subscribing..." : "Enable Alerts"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast.open ? (
        <div
          className={[
            "absolute right-0 top-14 z-[3600] min-w-[210px] rounded-xl px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur",
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