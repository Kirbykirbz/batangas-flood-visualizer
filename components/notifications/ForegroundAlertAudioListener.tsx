"use client";

import { useEffect, useRef } from "react";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

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

const REPLAY_COOLDOWN_MS = 15000;

function resolveSoundKey(payload: PushBridgePayload): SoundKey {
  if (payload.soundKey) return payload.soundKey;

  switch (payload.level) {
    case "overflow":
      return "overflow-alarm";
    case "danger":
      return "danger-alarm";
    case "warning":
    case "watch":
      return "warning-soft";
    default:
      return null;
  }
}

export default function ForegroundAlertAudioListener() {
  const warningAudioRef = useRef<HTMLAudioElement | null>(null);
  const dangerAudioRef = useRef<HTMLAudioElement | null>(null);
  const overflowAudioRef = useRef<HTMLAudioElement | null>(null);

  const unlockedRef = useRef(false);
  const lastPlayedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    warningAudioRef.current = new Audio("/sounds/warning-soft.mp3");
    dangerAudioRef.current = new Audio("/sounds/danger-alarm.mp3");
    overflowAudioRef.current = new Audio("/sounds/overflow-alarm.mp3");

    const all = [
      warningAudioRef.current,
      dangerAudioRef.current,
      overflowAudioRef.current,
    ];

    for (const audio of all) {
      if (audio) {
        audio.preload = "auto";
      }
    }

    async function unlockAudio() {
      if (unlockedRef.current) return;

      const audios = all.filter(Boolean) as HTMLAudioElement[];

      try {
        for (const audio of audios) {
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

        unlockedRef.current = true;
      } catch {
        // ignore
      }
    }

    function handleFirstInteraction() {
      void unlockAudio();
    }

    window.addEventListener("pointerdown", handleFirstInteraction, {
      passive: true,
    });
    window.addEventListener("keydown", handleFirstInteraction);

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);

      for (const audio of all) {
        if (audio) {
          audio.pause();
          audio.src = "";
        }
      }
    };
  }, []);

  useEffect(() => {
    function vibrateIfPossible(pattern?: number[]) {
      if (typeof navigator === "undefined") return;
      if (!("vibrate" in navigator)) return;
      if (!Array.isArray(pattern) || pattern.length === 0) return;

      try {
        navigator.vibrate(pattern);
      } catch {
        // ignore
      }
    }

    async function playBySoundKey(soundKey: SoundKey) {
      if (!soundKey) return;
      if (!unlockedRef.current) return;

      const audio =
        soundKey === "warning-soft"
          ? warningAudioRef.current
          : soundKey === "danger-alarm"
          ? dangerAudioRef.current
          : overflowAudioRef.current;

      if (!audio) return;

      try {
        audio.pause();
        audio.currentTime = 0;
        await audio.play();
      } catch {
        // ignore browser playback failures
      }
    }

    function onMessage(event: MessageEvent<ServiceWorkerBridgeMessage>) {
      const data = event.data;
      if (!data || data.type !== "FLOOD_ALERT_PUSH_RECEIVED") {
        return;
      }

      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      const payload = data.payload;
      if (!payload) return;

      const soundKey = resolveSoundKey(payload);

      const dedupKey =
        payload.alertId != null
          ? `alert:${payload.alertId}`
          : `${payload.deviceId ?? "global"}:${payload.level}:${soundKey ?? "none"}`;

      const now = Date.now();
      const lastPlayed = lastPlayedRef.current.get(dedupKey) ?? 0;

      if (now - lastPlayed < REPLAY_COOLDOWN_MS) {
        return;
      }

      lastPlayedRef.current.set(dedupKey, now);

      vibrateIfPossible(payload.vibrate);
      void playBySoundKey(soundKey);
    }

    if (!navigator.serviceWorker) {
      return;
    }

    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}