import { NextResponse } from "next/server";
import { getRainEventById } from "@/app/lib/eventsRepoServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const eventId = Number(id);

  if (!Number.isFinite(eventId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid event id" },
      { status: 400 }
    );
  }

  try {
    const event = await getRainEventById(eventId);

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Event not found" },
        { status: 404 }
      );
    }

    const { error } = await supabaseAdmin
      .from("rain_events")
      .delete()
      .eq("id", eventId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: `[delete event] ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, eventId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to delete event",
      },
      { status: 500 }
    );
  }
}