"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.warn("[PWA] Service workers are not supported in this browser.");
      return;
    }

    let isMounted = true;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        if (!isMounted) return;

        console.log("[PWA] service worker registered:", registration.scope);

        if (registration.installing) {
          console.log("[PWA] service worker installing...");
        }

        if (registration.waiting) {
          console.log("[PWA] service worker waiting...");
        }

        if (registration.active) {
          console.log("[PWA] service worker active.");
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          console.log("[PWA] update found, installing new service worker...");

          newWorker.addEventListener("statechange", () => {
            console.log("[PWA] new service worker state:", newWorker.state);

            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              console.log("[PWA] new content is available; refresh may be needed.");
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          console.log("[PWA] service worker controller changed.");
        });
      } catch (error) {
        console.error("[PWA] service worker registration failed:", error);
      }
    };

    registerServiceWorker();

    return () => {
      isMounted = false;
    };
  }, []);

  return null;
}