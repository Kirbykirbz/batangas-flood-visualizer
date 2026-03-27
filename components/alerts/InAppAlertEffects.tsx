"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";

type AlertRecord = {
  id: number;
  device_id: string;
  rain_event_id: number | null;
  level: AlertLevel;
  title: string;
  message: string;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
};

type AlertsResponse = {
  ok: boolean;
  alerts?: AlertRecord[];
  serverTime?: number;
  error?: string;
};

type ActiveToast = {
  id: number;
  level: AlertLevel;
  title: string;
  message: string;
  deviceId: string;
  triggeredAt: string;
};

const STORAGE_KEY_LAST_HANDLED_ID = "flood:lastHandledAlertId";
const STORAGE_KEY_SOUND_MUTED = "flood:alertsMuted";

function levelClasses(level: AlertLevel) {
  switch (level) {
    case "overflow":
      return "border-red-300 bg-red-50 text-red-800";
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "watch":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-zinc-200 bg-white text-zinc-800";
  }
}

function pillClasses(level: AlertLevel) {
  switch (level) {
    case "overflow":
      return "bg-red-100 text-red-800 ring-1 ring-red-200";
    case "danger":
      return "bg-red-50 text-red-700 ring-1 ring-red-200";
    case "warning":
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
    case "watch":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    default:
      return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
  }
}

function canVibrate() {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

function vibrateForLevel(level: AlertLevel) {
  if (!canVibrate()) return;

  if (level === "warning") {
    navigator.vibrate?.(120);
    return;
  }

  if (level === "danger") {
    navigator.vibrate?.([250, 120, 250, 120, 400]);
    return;
  }

  if (level === "overflow") {
    navigator.vibrate?.([300, 120, 300, 120, 300, 120, 600]);
  }
}

async function safePlay(audio: HTMLAudioElement | null) {
  if (!audio) return;

  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    console.warn("[InAppAlertEffects] audio playback blocked or failed:", err);
  }
}

export default function InAppAlertEffects() {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [watchCount, setWatchCount] = useState(0);
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY_SOUND_MUTED) === "1";
  });
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const warningAudioRef = useRef<HTMLAudioElement | null>(null);
  const dangerAudioRef = useRef<HTMLAudioElement | null>(null);
  const overflowAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastHandledIdRef = useRef<number>(0);
  const initializedRef = useRef(false);

  useEffect(() => {
    const savedLastHandled = localStorage.getItem(STORAGE_KEY_LAST_HANDLED_ID);
    const parsed = Number(savedLastHandled ?? "0");
    lastHandledIdRef.current = Number.isFinite(parsed) ? parsed : 0;

    warningAudioRef.current = new Audio("/sounds/warning-soft.mp3");
    dangerAudioRef.current = new Audio("/sounds/danger-alarm.mp3");
    overflowAudioRef.current = new Audio("/sounds/overflow-alarm.mp3");

    warningAudioRef.current.preload = "auto";
    dangerAudioRef.current.preload = "auto";
    overflowAudioRef.current.preload = "auto";

    initializedRef.current = true;
  }, []);

  useEffect(() => {
    function unlockAudio() {
      setAudioUnlocked(true);
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  async function playEffectsForAlert(alert: AlertRecord) {
    if (alert.level === "watch" || alert.level === "info") return;

    if (alert.level === "warning") {
      if (!muted && audioUnlocked) {
        await safePlay(warningAudioRef.current);
      }
      vibrateForLevel("warning");
      return;
    }

    if (alert.level === "danger") {
      if (!muted && audioUnlocked) {
        await safePlay(dangerAudioRef.current);
      }
      vibrateForLevel("danger");
      return;
    }

    if (alert.level === "overflow") {
      if (!muted && audioUnlocked) {
        await safePlay(overflowAudioRef.current);
      }
      vibrateForLevel("overflow");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function pollAlerts() {
      if (!initializedRef.current) return;

      try {
        const res = await fetch("/api/alerts?limit=20&openOnly=1", {
          cache: "no-store",
        });

        const data = (await res.json()) as AlertsResponse;

        if (!res.ok || !data.ok || !data.alerts) {
          return;
        }

        const alerts = [...data.alerts].sort((a, b) => a.id - b.id);
        const newAlerts = alerts.filter((a) => a.id > lastHandledIdRef.current);

        if (!newAlerts.length) {
          return;
        }

        const newWatchs = newAlerts.filter((a) => a.level === "watch").length;
        if (!cancelled && newWatchs > 0) {
          setWatchCount((prev) => prev + newWatchs);
        }

        const newestVisible = [...newAlerts]
          .reverse()
          .find(
            (a) =>
              a.level === "warning" ||
              a.level === "danger" ||
              a.level === "overflow"
          );

        if (!cancelled && newestVisible) {
          setToast({
            id: newestVisible.id,
            level: newestVisible.level,
            title: newestVisible.title,
            message: newestVisible.message,
            deviceId: newestVisible.device_id,
            triggeredAt: newestVisible.triggered_at,
          });

          await playEffectsForAlert(newestVisible);
        }

        const maxHandledId =
          newAlerts[newAlerts.length - 1]?.id ?? lastHandledIdRef.current;

        lastHandledIdRef.current = Math.max(lastHandledIdRef.current, maxHandledId);
        localStorage.setItem(
          STORAGE_KEY_LAST_HANDLED_ID,
          String(lastHandledIdRef.current)
        );
      } catch (err) {
        console.warn("[InAppAlertEffects] polling failed:", err);
      }
    }

    pollAlerts();
    const id = window.setInterval(pollAlerts, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [muted, audioUnlocked]);

  const watchBadge = useMemo(() => {
    if (watchCount <= 0) return null;
    return watchCount > 99 ? "99+" : String(watchCount);
  }, [watchCount]);

  function toggleMuted() {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_SOUND_MUTED, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      {watchBadge && (
        <div className="fixed right-4 top-20 z-[3400]">
          <button
            type="button"
            onClick={() => setWatchCount(0)}
            className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 shadow-sm"
            title="Watch alerts detected"
          >
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
              {watchBadge}
            </span>
            Watch alerts
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed right-4 top-32 z-[3500] w-[min(92vw,380px)]">
          <div
            className={`rounded-2xl border p-4 shadow-2xl ${levelClasses(
              toast.level
            )}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pillClasses(
                      toast.level
                    )}`}
                  >
                    {toast.level.toUpperCase()}
                  </span>
                  <span className="text-xs opacity-80">{toast.deviceId}</span>
                </div>

                <div className="mt-2 text-sm font-extrabold">{toast.title}</div>
                <div className="mt-2 text-sm leading-6">{toast.message}</div>
                <div className="mt-2 text-xs opacity-70">
                  {new Date(toast.triggeredAt).toLocaleString()}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setToast(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold opacity-70 hover:bg-white/50"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleMuted}
                className="rounded-xl border border-white/50 bg-white/60 px-3 py-2 text-xs font-bold text-zinc-800 hover:bg-white"
              >
                {muted ? "Unmute alerts" : "Mute alerts"}
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/dashboard/admin/alerts";
                }}
                className="rounded-xl border border-white/50 bg-white/60 px-3 py-2 text-xs font-bold text-zinc-800 hover:bg-white"
              >
                Open alerts
              </button>

              <button
                type="button"
                onClick={() => setToast(null)}
                className="rounded-xl border border-white/50 bg-white/60 px-3 py-2 text-xs font-bold text-zinc-800 hover:bg-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}