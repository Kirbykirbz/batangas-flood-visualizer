
// app/api/push/subscribe/route.ts
import { NextResponse } from "next/server";
import { upsertPushSubscriptionServer } from "@/app/lib/pushRepoServer";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
      scope?: string | null;
      targetDeviceIds?: string[] | null;
      userId?: string | null;
    };

    const endpoint = String(body.endpoint ?? "").trim();
    const p256dh = String(body.p256dh ?? "").trim();
    const auth = String(body.auth ?? "").trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "endpoint, p256dh, and auth are required" },
        { status: 400 }
      );
    }

    const scope = body.scope === "device" ? "device" : "all";

    const id = await upsertPushSubscriptionServer({
      user_id: body.userId ?? null,
      endpoint,
      p256dh,
      auth,
      scope,
      targetDeviceIds: Array.isArray(body.targetDeviceIds)
        ? body.targetDeviceIds
        : [],
    });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("[POST /api/push/subscribe] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to subscribe push notifications",
      },
      { status: 500 }
    );
  }
}