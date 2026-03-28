//app/lib/pushNotifier.ts
type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

type SendPushPayload = {
  title: string;
  message: string;
  url?: string;
  deviceId?: string | null;
  sensorName?: string | null;
  zoneLabel?: string | null;
  alertId?: number | null;
  level?: AlertLevel;
  soundKey?: SoundKey;
  vibrate?: number[];
  triggeredAt?: string;
};

function resolveBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function defaultSoundKeyForLevel(level: AlertLevel): SoundKey {
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

function defaultVibrationForLevel(level: AlertLevel): number[] | undefined {
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

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendPushAlert(payload: SendPushPayload) {
  const baseUrl = resolveBaseUrl();
  const endpoint = `${baseUrl}/api/push/send`;

  const level: AlertLevel = payload.level ?? "info";
  const soundKey = payload.soundKey ?? defaultSoundKeyForLevel(level);
  const vibrate = payload.vibrate ?? defaultVibrationForLevel(level);

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
        sensorName: payload.sensorName ?? null,
        zoneLabel: payload.zoneLabel ?? null,
        alertId: payload.alertId ?? null,
        level,
        soundKey,
        vibrate,
        triggeredAt: payload.triggeredAt ?? new Date().toISOString(),
      }),
    });

    let data: Record<string, unknown> | null = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }

    if (!res.ok) {
      const errorMessage = String(
        data?.error ?? `Push send failed (${res.status}) ${res.statusText}`
      );
      throw new Error(errorMessage);
    }

    return data;
  } catch (err) {
    console.error("[pushNotifier] sendPushAlert failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}