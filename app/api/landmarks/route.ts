import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("landmarks")
    .select("id, name, description, lat, lng, category, icon_key, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[api/landmarks] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load landmarks" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    landmarks: data ?? [],
  });
}