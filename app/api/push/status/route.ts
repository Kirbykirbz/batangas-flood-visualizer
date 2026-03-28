import { NextResponse } from "next/server";
import { getPushSubscriptionStatusServer } from "@/app/lib/pushRepoServer";

type PushStatusResponse =
  | {
      ok: true;
      subscription: {
        isActive: boolean;
        scope: "all" | "device";
        targetDeviceIds: string[];
      } | null;
    }
  | {
      ok: false;
      error: string;
    };

export async function POST(req: Request): Promise<NextResponse<PushStatusResponse>> {
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

    const subscription = await getPushSubscriptionStatusServer(endpoint);

    return NextResponse.json({
      ok: true,
      subscription,
    } as PushStatusResponse);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load push subscription status",
      },
      { status: 500 }
    );
  }
}