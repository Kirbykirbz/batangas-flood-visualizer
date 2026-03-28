import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 200))
      : 100;

    const { data, error } = await supabaseAdmin
      .from("rain_events")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`[GET /api/admin/events] ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      events: data ?? [],
    });
  } catch (error) {
    console.error("[GET /api/admin/events] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to load admin events",
      },
      { status: 500 }
    );
  }
}