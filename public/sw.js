const SW_VERSION = "v1";
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
 * PUSH
 * Preserves your existing push behavior and defaults.
 */
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "Flood Alert",
      body: event.data ? event.data.text() : "New notification received.",
    };
  }

  const title = data.title || "Flood Alert";
  const options = {
    body: data.body || "New flood monitoring update.",
    icon: data.icon || "/flood-icon.png",
    badge: data.badge || "/flood-icon.png",
    data: {
      url: data.url || "/dashboard",
    },
    tag: data.tag || "flood-alert",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * NOTIFICATION CLICK
 * Preserves your dashboard redirect behavior.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url &&
    typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});