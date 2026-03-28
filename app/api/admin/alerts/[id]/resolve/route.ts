// app/api/admin/alerts/[id]/resolve/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;
    const alertId = Number(id);

    if (!Number.isInteger(alertId) || alertId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid alert id." },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("alerts")
      .select("id, resolved_at, acknowledged")
      .eq("id", alertId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { ok: false, error: "Alert not found." },
        { status: 404 }
      );
    }

    if (existing.resolved_at) {
      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("alerts")
      .update({
        resolved_at: now,
        acknowledged: true,
        acknowledged_at: existing.acknowledged ? undefined : now,
      })
      .eq("id", alertId);

    if (updateError) {
      console.error("[POST /api/admin/alerts/:id/resolve] failed:", updateError);
      return NextResponse.json(
        { ok: false, error: "Failed to resolve alert." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/admin/alerts/:id/resolve] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}