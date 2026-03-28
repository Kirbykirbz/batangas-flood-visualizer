"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;
type SoundMode = "off" | "important-only" | "all";

type PushBridgePayload = {
  title: string;
  body: string;
  url: string;
  level: AlertLevel;
  deviceId: string | null;
  sensorName: string | null;
  zoneLabel: string | null;
  alertId: number | null;
  soundKey: SoundKey;
  triggeredAt: string;
  vibrate?: number[];
};

type ServiceWorkerBridgeMessage = {
  type: "FLOOD_ALERT_PUSH_RECEIVED";
  payload: PushBridgePayload;
};

const STORAGE_KEY_MODE = "flood_foreground_sound_mode";
const STORAGE_KEY_UNLOCKED = "flood_foreground_sound_unlocked";
const REPLAY_COOLDOWN_MS = 20000;

function shouldPlayForMode(mode: SoundMode, level: AlertLevel, soundKey: SoundKey) {
  if (mode === "off") return false;
  if (!soundKey) return false;
  if (mode === "all") return true;
  return level === "danger" || level === "overflow";
}

function getStoredMode(): SoundMode {
  if (typeof window === "undefined") return "important-only";
  const raw = window.localStorage.getItem(STORAGE_KEY_MODE);
  if (raw === "off" || raw === "important-only" || raw === "all") {
    return raw;
  }
  return "important-only";
}

function getStoredUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY_UNLOCKED) === "true";
}

function compactWhen(iso: string) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "now";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export default function ForegroundAlertSoundBridge() {
  const [mode, setMode] = useState<SoundMode>(() => getStoredMode());
  const [unlocked, setUnlocked] = useState<boolean>(() => getStoredUnlocked());
  const [statusText, setStatusText] = useState("");
  const [lastEventText, setLastEventText] = useState("");

  const audioWarningRef = useRef<HTMLAudioElement | null>(null);
  const audioDangerRef = useRef<HTMLAudioElement | null>(null);
  const audioOverflowRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    audioWarningRef.current = new Audio("/sounds/warning-soft.mp3");
    audioDangerRef.current = new Audio("/sounds/danger-alarm.mp3");
    audioOverflowRef.current = new Audio("/sounds/overflow-alarm.mp3");

    const all = [
      audioWarningRef.current,
      audioDangerRef.current,
      audioOverflowRef.current,
    ];

    for (const audio of all) {
      if (audio) {
        audio.preload = "auto";
      }
    }

    return () => {
      for (const audio of all) {
        if (audio) {
          audio.pause();
          audio.src = "";
        }
      }
    };
  }, []);

  function persistMode(nextMode: SoundMode) {
    setMode(nextMode);
    try {
      window.localStorage.setItem(STORAGE_KEY_MODE, nextMode);
    } catch {}
  }

  async function unlockAudio() {
    try {
      const all = [
        audioWarningRef.current,
        audioDangerRef.current,
        audioOverflowRef.current,
      ].filter(Boolean) as HTMLAudioElement[];

      for (const audio of all) {
        audio.volume = 1;
        audio.muted = true;
        audio.currentTime = 0;

        try {
          await audio.play();
        } catch {}

        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }

      setUnlocked(true);
      setStatusText("Foreground sound enabled.");

      try {
        window.localStorage.setItem(STORAGE_KEY_UNLOCKED, "true");
      } catch {}
    } catch {
      setStatusText("Unable to unlock sound yet. Try again after interacting with the page.");
    }
  }

  async function playSound(soundKey: SoundKey) {
    if (!soundKey) return;

    const target =
      soundKey === "warning-soft"
        ? audioWarningRef.current
        : soundKey === "danger-alarm"
        ? audioDangerRef.current
        : audioOverflowRef.current;

    if (!target) return;

    try {
      target.pause();
      target.currentTime = 0;
      await target.play();
    } catch {}
  }

  function playForegroundVibration(pattern?: number[]) {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    if (!Array.isArray(pattern) || pattern.length === 0) return;

    try {
      navigator.vibrate(pattern);
    } catch {}
  }

  useEffect(() => {
    function onMessage(event: MessageEvent<ServiceWorkerBridgeMessage>) {
      const data = event.data;
      if (!data || data.type !== "FLOOD_ALERT_PUSH_RECEIVED") return;

      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      const payload = data.payload;
      if (!payload) return;

      setLastEventText(
        `${payload.title} • ${payload.sensorName ?? payload.deviceId ?? "general"} • ${compactWhen(
          payload.triggeredAt
        )}`
      );

      playForegroundVibration(payload.vibrate);

      if (!unlocked) {
        setStatusText("Push received, but foreground sound is still locked.");
        return;
      }

      if (!shouldPlayForMode(mode, payload.level, payload.soundKey)) {
        return;
      }

      const dedupKey =
        payload.alertId != null
          ? `alert:${payload.alertId}`
          : `${payload.deviceId ?? "global"}:${payload.level}:${payload.soundKey ?? "none"}`;

      const now = Date.now();
      const lastPlayed = lastPlayedRef.current.get(dedupKey) ?? 0;

      if (now - lastPlayed < REPLAY_COOLDOWN_MS) {
        return;
      }

      lastPlayedRef.current.set(dedupKey, now);
      void playSound(payload.soundKey);
    }

    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [mode, unlocked]);

  const modeLabel = useMemo(() => {
    switch (mode) {
      case "off":
        return "Sound Off";
      case "all":
        return "All Alerts";
      default:
        return "Danger + Overflow";
    }
  }, [mode]);

  return (
    <div className="fixed bottom-3 left-3 z-[2500] max-w-[92vw]">
      <div className="rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Foreground Alert Audio
            </div>
            <div className="mt-1 text-sm font-bold text-zinc-900">{modeLabel}</div>
            <div className="mt-1 text-xs text-zinc-600">
              {unlocked
                ? "Foreground sound is ready when push arrives while this app is open."
                : "Click enable once so the browser allows in-app sound playback."}
            </div>
            {statusText ? (
              <div className="mt-1 text-xs text-zinc-500">{statusText}</div>
            ) : null}
            {lastEventText ? (
              <div className="mt-1 truncate text-xs text-zinc-500">
                Last push: {lastEventText}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void unlockAudio()}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Enable Sound
            </button>

            <select
              value={mode}
              onChange={(e) => persistMode(e.target.value as SoundMode)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-900 shadow-sm"
            >
              <option value="off">Sound Off</option>
              <option value="important-only">Danger + Overflow</option>
              <option value="all">All Alert Sounds</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}