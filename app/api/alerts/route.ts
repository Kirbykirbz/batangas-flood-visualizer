import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const openOnly = searchParams.get("openOnly") === "1";

    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(Math.floor(limitRaw), 100))
      : 20;

    let query = supabaseAdmin
      .from("alerts")
      .select("*")
      .order("triggered_at", { ascending: false })
      .limit(limit);

    if (openOnly) {
      query = query.is("resolved_at", null);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      alerts: data ?? [],
      serverTime: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load alerts.",
      },
      { status: 500 }
    );
  }
}
