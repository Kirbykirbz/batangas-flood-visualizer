"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

function getInitialInstalledState() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(display-mode: standalone)").matches;
}

export function useInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  const [isInstalled, setIsInstalled] = useState<boolean>(
    getInitialInstalledState
  );

  const [isInstallAvailable, setIsInstallAvailable] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      const deferredEvent = event as BeforeInstallPromptEvent;
      setInstallEvent(deferredEvent);
      setIsInstallAvailable(true);
    }

    function handleAppInstalled() {
      setIsInstalled(true);
      setInstallEvent(null);
      setIsInstallAvailable(false);
    }

    function handleDisplayModeChange(event: MediaQueryListEvent) {
      setIsInstalled(event.matches);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    media.addEventListener("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      media.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) {
      return {
        outcome: "dismissed" as const,
        available: false,
      };
    }

    await installEvent.prompt();
    const choice = await installEvent.userChoice;

    if (choice.outcome === "accepted") {
      setInstallEvent(null);
      setIsInstallAvailable(false);
    }

    return {
      outcome: choice.outcome,
      available: true,
    };
  }, [installEvent]);

  return {
    isInstalled,
    isInstallAvailable,
    promptInstall,
  };
}