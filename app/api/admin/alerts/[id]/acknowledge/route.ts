import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();

    const { id } = await context.params;
    const alertId = Number(id);

    if (!Number.isInteger(alertId) || alertId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid alert id." },
        { status: 400 }
      );
    }

    const { data: existingAlert, error: existingError } = await supabaseAdmin
      .from("alerts")
      .select("id, acknowledged, acknowledged_at, resolved_at")
      .eq("id", alertId)
      .single();

    if (existingError || !existingAlert) {
      console.error(
        "[POST /api/admin/alerts/[id]/acknowledge] alert lookup failed:",
        existingError
      );

      return NextResponse.json(
        { ok: false, error: "Alert not found." },
        { status: 404 }
      );
    }

    if (existingAlert.acknowledged) {
      return NextResponse.json({ ok: true });
    }

    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("alerts")
      .update({
        acknowledged: true,
        acknowledged_at: nowIso,
      })
      .eq("id", alertId);

    if (updateError) {
      console.error(
        "[POST /api/admin/alerts/[id]/acknowledge] update failed:",
        updateError
      );

      return NextResponse.json(
        { ok: false, error: "Failed to acknowledge alert." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[POST /api/admin/alerts/[id]/acknowledge] unexpected error:",
      error
    );

    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}   