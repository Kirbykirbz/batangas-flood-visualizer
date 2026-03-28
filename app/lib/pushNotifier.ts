//app/lib/pushNotifier.ts

type SendPushPayload = {
  title: string;
  message: string;
  url?: string;
  deviceId?: string | null;
};

function resolveBaseUrl(): string {
  // 1. Explicit override (best for production)
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }

  // 2. Next.js public env (fallback)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // 3. Vercel automatic URL (important!)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 4. Local fallback
  return "http://localhost:3000";
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendPushAlert(payload: SendPushPayload) {
  const baseUrl = resolveBaseUrl();
  const endpoint = `${baseUrl}/api/push/send`;

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: payload.title,
        message: payload.message,
        url: payload.url ?? "/dashboard",
        deviceId: payload.deviceId ?? null,
      }),
    });

    let data: Record<string, unknown> | null = null;
    try {
      data = await res.json();
    } catch {
      // ignore JSON parse errors
    }

    if (!res.ok) {
      const errorMessage =
        String(data?.error ||
        `Push send failed (${res.status}) ${res.statusText}`);

      throw new Error(errorMessage);
    }

    return data;
  } catch (err) {
    // Important: do NOT crash your ingest pipeline
    console.error("[pushNotifier] sendPushAlert failed:", err);

    // Optionally return a structured result instead of throwing
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}