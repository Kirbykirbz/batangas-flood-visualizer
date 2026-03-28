//app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { listActivePushSubscriptions } from "@/app/lib/pushRepo";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";
type SoundKey = "warning-soft" | "danger-alarm" | "overflow-alarm" | null;

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const privateKey = process.env.VAPID_PRIVATE_KEY!;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

webpush.setVapidDetails(subject, publicKey, privateKey);

function normalizeLevel(value: unknown): AlertLevel {
  return value === "watch" ||
    value === "warning" ||
    value === "danger" ||
    value === "overflow" ||
    value === "info"
    ? value
    : "info";
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title
        : "Flood Alert";

    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : "New flood update.";

    const url =
      typeof body.url === "string" && body.url.trim()
        ? body.url
        : "/dashboard";

    const deviceId =
      typeof body.deviceId === "string" && body.deviceId.trim()
        ? body.deviceId
        : null;

    const sensorName =
      typeof body.sensorName === "string" && body.sensorName.trim()
        ? body.sensorName
        : null;

    const zoneLabel =
      typeof body.zoneLabel === "string" && body.zoneLabel.trim()
        ? body.zoneLabel
        : null;

    const alertId =
      Number.isFinite(Number(body.alertId)) && body.alertId != null
        ? Number(body.alertId)
        : null;

    const level = normalizeLevel(body.level);

    const soundKey: SoundKey =
      body.soundKey === "warning-soft" ||
      body.soundKey === "danger-alarm" ||
      body.soundKey === "overflow-alarm"
        ? body.soundKey
        : defaultSoundKeyForLevel(level);

    const vibrate =
      Array.isArray(body.vibrate) && body.vibrate.every((n: unknown) => typeof n === "number")
        ? (body.vibrate as number[])
        : defaultVibrationForLevel(level);

    const triggeredAt =
      typeof body.triggeredAt === "string" && body.triggeredAt.trim()
        ? body.triggeredAt
        : new Date().toISOString();

    const subscriptions = await listActivePushSubscriptions(deviceId);

    const payload = JSON.stringify({
      title,
      body: message,
      url,
      deviceId,
      sensorName,
      zoneLabel,
      alertId,
      level,
      soundKey,
      triggeredAt,
      vibrate,
      icon: "/flood-icon.png",
      badge: "/flood-icon.png",
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
        return { endpoint: sub.endpoint, ok: true };
      })
    );

    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to send push notifications.",
      },
      { status: 500 }
    );
  }
}