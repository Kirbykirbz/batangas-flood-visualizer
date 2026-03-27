// app/api/push/unsubscribe/route.ts

import { NextResponse } from "next/server";
import { deactivatePushSubscriptionServer } from "@/app/lib/pushRepoServer";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      endpoint?: string;
    };

    const endpoint = String(body.endpoint ?? "").trim();

    if (!endpoint) {
      return NextResponse.json(
        { ok: false, error: "endpoint is required" },
        { status: 400 }
      );
    }

    await deactivatePushSubscriptionServer(endpoint);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/push/unsubscribe] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to unsubscribe push notifications",
      },
      { status: 500 }
    );
  }
}