//app/api/push/send/route.ts

import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { listActivePushSubscriptions, deactivatePushSubscription } from "@/app/lib/pushRepo";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const privateKey = process.env.VAPID_PRIVATE_KEY!;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

webpush.setVapidDetails(subject, publicKey, privateKey);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const title = typeof body.title === "string" ? body.title : "Flood Alert";
    const message = typeof body.message === "string" ? body.message : "New flood update.";
    const url = typeof body.url === "string" ? body.url : "/dashboard";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : null;

    const subscriptions = await listActivePushSubscriptions(deviceId);

    const payload = JSON.stringify({
      title,
      body: message,
      icon: "/flood-icon.png",
      badge: "/flood-icon.png",
      url,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
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
        } catch (err: unknown) {
          if (err instanceof Error && 'statusCode' in err && (err.statusCode === 404 || err.statusCode === 410)) {
            await deactivatePushSubscription(sub.endpoint);
          }
          throw err;
        }
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
        error: err instanceof Error ? err.message : "Failed to send push notifications.",
      },
      { status: 500 }
    );
  }
}