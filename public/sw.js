const SW_VERSION = "v2";
const STATIC_CACHE = `flood-monitor-static-${SW_VERSION}`;
const RUNTIME_CACHE = `flood-monitor-runtime-${SW_VERSION}`;

const APP_SHELL = [
  "/",
  "/dashboard",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
];

/**
 * INSTALL
 * Pre-cache a minimal shell so the app can boot offline.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn("[sw] precache failed:", url, error);
        }
      }
    })
  );

  self.skipWaiting();
});

/**
 * ACTIVATE
 * Remove old caches and immediately control open clients.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

/**
 * FETCH
 *
 * Rules:
 * - Ignore non-GET
 * - /api/* => network-first
 * - page navigations => network-first with cached fallback
 * - static assets => cache-first
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // API routes: network-first, no API caching
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // HTML/document navigation: network-first
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // static assets: cache-first
  event.respondWith(cacheFirstStatic(request));
});

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        offline: true,
        error: "Network unavailable",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

async function networkFirstPage(request) {
  try {
    const freshResponse = await fetch(request);

    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, freshResponse.clone());

    return freshResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const dashboardFallback = await caches.match("/dashboard");
    if (dashboardFallback) {
      return dashboardFallback;
    }

    const rootFallback = await caches.match("/");
    if (rootFallback) {
      return rootFallback;
    }

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const freshResponse = await fetch(request);

    if (
      freshResponse &&
      freshResponse.status === 200 &&
      freshResponse.type === "basic"
    ) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, freshResponse.clone());
    }

    return freshResponse;
  } catch (error) {
    const fallback = await caches.match(request);
    if (fallback) {
      return fallback;
    }

    return new Response("Resource unavailable offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * ALERT HELPERS
 */
function normalizeLevel(level) {
  if (
    level === "watch" ||
    level === "warning" ||
    level === "danger" ||
    level === "overflow" ||
    level === "info"
  ) {
    return level;
  }
  return "info";
}

function vibrationPatternForLevel(level) {
  switch (level) {
    case "overflow":
      return [300, 120, 300, 120, 500];
    case "danger":
      return [240, 100, 240, 100, 240];
    case "warning":
      return [180, 100, 180];
    case "watch":
      return [120, 80, 120];
    default:
      return undefined;
  }
}

function soundKeyForLevel(level) {
  switch (level) {
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

function buildNotificationTag(payload) {
  if (payload.alertId != null) {
    return `flood-alert-${payload.alertId}`;
  }

  if (payload.deviceId) {
    return `flood-alert-device-${payload.deviceId}-${payload.level}`;
  }

  return `flood-alert-global-${payload.level}`;
}

/**
 * Notify any open windows so the foreground app can play sound,
 * show in-app banners, or update live UI.
 */
async function notifyOpenClients(payload) {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  await Promise.all(
    clientList.map((client) =>
      client.postMessage({
        type: "FLOOD_ALERT_PUSH_RECEIVED",
        payload,
      })
    )
  );
}

/**
 * PUSH
 *
 * Supports:
 * - manual push
 * - automated push
 * - DB-backed dynamic alerts
 * - foreground message fanout to open tabs/PWA windows
 */
self.addEventListener("push", (event) => {
  let raw = {};

  try {
    raw = event.data ? event.data.json() : {};
  } catch {
    raw = {
      title: "Flood Alert",
      body: event.data ? event.data.text() : "New notification received.",
    };
  }

  const level = normalizeLevel(raw.level);
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : "Flood Alert";

  const body =
    typeof raw.body === "string" && raw.body.trim()
      ? raw.body
      : "New flood monitoring update.";

  const url =
    typeof raw.url === "string" && raw.url.trim()
      ? raw.url
      : "/dashboard";

  const payload = {
    title,
    body,
    url,
    level,
    deviceId:
      typeof raw.deviceId === "string" && raw.deviceId.trim()
        ? raw.deviceId
        : null,
    sensorName:
      typeof raw.sensorName === "string" && raw.sensorName.trim()
        ? raw.sensorName
        : null,
    zoneLabel:
      typeof raw.zoneLabel === "string" && raw.zoneLabel.trim()
        ? raw.zoneLabel
        : null,
    alertId:
      Number.isFinite(Number(raw.alertId)) && raw.alertId != null
        ? Number(raw.alertId)
        : null,
    soundKey:
      typeof raw.soundKey === "string" && raw.soundKey.trim()
        ? raw.soundKey
        : soundKeyForLevel(level),
    triggeredAt:
      typeof raw.triggeredAt === "string" && raw.triggeredAt.trim()
        ? raw.triggeredAt
        : new Date().toISOString(),
    vibrate: Array.isArray(raw.vibrate)
      ? raw.vibrate
      : vibrationPatternForLevel(level),
    tag:
      typeof raw.tag === "string" && raw.tag.trim()
        ? raw.tag
        : buildNotificationTag({
            alertId:
              Number.isFinite(Number(raw.alertId)) && raw.alertId != null
                ? Number(raw.alertId)
                : null,
            deviceId:
              typeof raw.deviceId === "string" && raw.deviceId.trim()
                ? raw.deviceId
                : null,
            level,
          }),
    requireInteraction: level === "danger" || level === "overflow",
    icon:
      typeof raw.icon === "string" && raw.icon.trim()
        ? raw.icon
        : "/flood-icon.png",
    badge:
      typeof raw.badge === "string" && raw.badge.trim()
        ? raw.badge
        : "/flood-icon.png",
  };

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: {
      url: payload.url,
      level: payload.level,
      deviceId: payload.deviceId,
      alertId: payload.alertId,
      soundKey: payload.soundKey,
      triggeredAt: payload.triggeredAt,
    },
    tag: payload.tag,
    renotify: true,
    requireInteraction: payload.requireInteraction,
    vibrate: payload.vibrate,
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      notifyOpenClients(payload),
    ])
  );
});

/**
 * NOTIFICATION CLICK
 * Opens or focuses the dashboard/PWA window.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url &&
    typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) {
              client.navigate(targetUrl);
            }
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return Promise.resolve();
      })
  );
});