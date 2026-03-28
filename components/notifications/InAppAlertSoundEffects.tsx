"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DerivedAlertLevel = "watch" | "warning" | "danger" | "overflow" | null;
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

type OverviewItem = {
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;
  latestReadingAt: string | null;
  rainRateMmh: number | null;
  floodDepthCm: number | null;
  overflow: boolean;
  floodCategory: "NORMAL" | "WATCH" | "WARNING" | "DANGER" | "OVERFLOW";
  rainCategory:
    | "NONE"
    | "LIGHT"
    | "MODERATE"
    | "HEAVY"
    | "VERY_HEAVY"
    | "EXTREME";
  derivedLevel: DerivedAlertLevel;
  soundKey: SoundKey;
  ongoingRainEventId: number | null;
  latestOpenAlert: {
    id: number;
    level: "watch" | "warning" | "danger" | "overflow" | "info";
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

type SoundMode = "off" | "important-only" | "all";

const POLL_MS = 12000;
const REPLAY_COOLDOWN_MS = 25000;
const STORAGE_KEY_MODE = "flood_sound_mode";
const STORAGE_KEY_UNLOCKED = "flood_sound_unlocked";

function levelRank(level: DerivedAlertLevel): number {
  switch (level) {
    case "overflow":
      return 4;
    case "danger":
      return 3;
    case "warning":
      return 2;
    case "watch":
      return 1;
    default:
      return 0;
  }
}

function soundSrc(soundKey: SoundKey): string | null {
  switch (soundKey) {
    case "warning-soft":
      return "/sounds/warning-soft.mp3";
    case "danger-alarm":
      return "/sounds/danger-alarm.mp3";
    case "overflow-alarm":
      return "/sounds/overflow-alarm.mp3";
    default:
      return null;
  }
}

function shouldPlayForMode(
  soundMode: SoundMode,
  level: DerivedAlertLevel,
  soundKey: SoundKey
): boolean {
  if (soundMode === "off") return false;
  if (!level || !soundKey) return false;

  if (soundMode === "all") {
    return true;
  }

  return level === "danger" || level === "overflow";
}

function readStoredSoundMode(): SoundMode {
  if (typeof window === "undefined") return "important-only";
  const raw = window.localStorage.getItem(STORAGE_KEY_MODE);
  if (raw === "off" || raw === "important-only" || raw === "all") {
    return raw;
  }
  return "important-only";
}

function readUnlockedState(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY_UNLOCKED) === "true";
}

export default function InAppAlertSoundEffects() {
  const [soundMode, setSoundMode] = useState<SoundMode>("important-only");
  const [unlocked, setUnlocked] = useState(false);
  const [statusText, setStatusText] = useState("");

  const audioWarningRef = useRef<HTMLAudioElement | null>(null);
  const audioDangerRef = useRef<HTMLAudioElement | null>(null);
  const audioOverflowRef = useRef<HTMLAudioElement | null>(null);

  const prevLevelsRef = useRef<Map<string, DerivedAlertLevel>>(new Map());
  const lastPlayedAtRef = useRef<Map<string, number>>(new Map());
  const pollBusyRef = useRef(false);

  useEffect(() => {
    setSoundMode(readStoredSoundMode());
    setUnlocked(readUnlockedState());
  }, []);

  useEffect(() => {
    audioWarningRef.current = new Audio("/sounds/warning-soft.mp3");
    audioDangerRef.current = new Audio("/sounds/danger-alarm.mp3");
    audioOverflowRef.current = new Audio("/sounds/overflow-alarm.mp3");

    audioWarningRef.current.preload = "auto";
    audioDangerRef.current.preload = "auto";
    audioOverflowRef.current.preload = "auto";

    return () => {
      const audios = [
        audioWarningRef.current,
        audioDangerRef.current,
        audioOverflowRef.current,
      ];
      for (const audio of audios) {
        if (audio) {
          audio.pause();
          audio.src = "";
        }
      }
    };
  }, []);

  function persistMode(nextMode: SoundMode) {
    setSoundMode(nextMode);
    try {
      window.localStorage.setItem(STORAGE_KEY_MODE, nextMode);
    } catch {}
  }

  async function unlockAudio() {
    try {
      const candidates = [
        audioWarningRef.current,
        audioDangerRef.current,
        audioOverflowRef.current,
      ].filter(Boolean) as HTMLAudioElement[];

      for (const audio of candidates) {
        audio.volume = 1;
        audio.muted = true;
        audio.currentTime = 0;

        try {
          await audio.play();
        } catch {
          // ignore
        }

        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }

      setUnlocked(true);
      setStatusText("Sound alerts enabled for this browser session.");
      try {
        window.localStorage.setItem(STORAGE_KEY_UNLOCKED, "true");
      } catch {}
    } catch {
      setStatusText("Unable to unlock audio yet. Try again after interacting with the page.");
    }
  }

  async function playSound(soundKey: SoundKey) {
    if (!soundKey) return;

    const audio =
      soundKey === "warning-soft"
        ? audioWarningRef.current
        : soundKey === "danger-alarm"
        ? audioDangerRef.current
        : audioOverflowRef.current;

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // autoplay restrictions or browser playback failure
    }
  }

  useEffect(() => {
    async function pollOverview() {
      if (pollBusyRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      pollBusyRef.current = true;

      try {
        const res = await fetch("/api/admin/alerts/overview", {
          cache: "no-store",
        });
        const json = (await res.json()) as OverviewResponse;

        if (!res.ok || !json.ok) {
          return;
        }

        const now = Date.now();
        const nextLevels = new Map<string, DerivedAlertLevel>();

        for (const item of json.items) {
          nextLevels.set(item.deviceId, item.derivedLevel);

          const prevLevel = prevLevelsRef.current.get(item.deviceId) ?? null;
          const currentLevel = item.derivedLevel;
          const currentRank = levelRank(currentLevel);
          const prevRank = levelRank(prevLevel);

          const escalated = currentRank > prevRank;
          const isNewActive = prevRank === 0 && currentRank > 0;
          const shouldConsider = escalated || isNewActive;

          if (!shouldConsider) {
            continue;
          }

          if (!shouldPlayForMode(soundMode, currentLevel, item.soundKey)) {
            continue;
          }

          if (!unlocked) {
            continue;
          }

          const cooldownKey = `${item.deviceId}:${item.soundKey ?? "none"}`;
          const lastPlayedAt = lastPlayedAtRef.current.get(cooldownKey) ?? 0;

          if (now - lastPlayedAt < REPLAY_COOLDOWN_MS) {
            continue;
          }

          lastPlayedAtRef.current.set(cooldownKey, now);
          await playSound(item.soundKey);
        }

        prevLevelsRef.current = nextLevels;
      } catch {
        // silent on purpose
      } finally {
        pollBusyRef.current = false;
      }
    }

    void pollOverview();

    const id = window.setInterval(() => {
      void pollOverview();
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [soundMode, unlocked]);

  const modeLabel = useMemo(() => {
    switch (soundMode) {
      case "off":
        return "Off";
      case "all":
        return "All alert sounds";
      default:
        return "Danger and overflow only";
    }
  }, [soundMode]);

  return (
    <div className="fixed bottom-3 left-3 z-[2500] max-w-[92vw]">
      <div className="rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              In-App Alert Sounds
            </div>
            <div className="mt-1 text-sm font-bold text-zinc-900">
              {modeLabel}
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              {unlocked
                ? "Audio unlocked."
                : "Click enable once so the browser allows alarm playback."}
            </div>
            {statusText ? (
              <div className="mt-1 text-xs text-zinc-500">{statusText}</div>
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
              value={soundMode}
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