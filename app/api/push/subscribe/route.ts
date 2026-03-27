import { NextRequest, NextResponse } from "next/server";
import { upsertPushSubscription } from "@/app/lib/pushRepo";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body.p256dh === "string" ? body.p256dh : "";
    const auth = typeof body.auth === "string" ? body.auth : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : null;
    const scope = typeof body.scope === "string" ? body.scope : null;

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "Missing subscription payload." },
        { status: 400 }
      );
    }

    await upsertPushSubscription({
      user_id: null,
      device_id: deviceId,
      endpoint,
      p256dh,
      auth,
      scope,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save subscription.",
      },
      { status: 500 }
    );
  }
}