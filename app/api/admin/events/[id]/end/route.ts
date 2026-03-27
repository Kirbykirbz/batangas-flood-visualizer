import { NextResponse } from "next/server";
import {
  getRainEventById,
  manuallyEndRainEvent,
} from "@/app/lib/eventsRepoServer";

export async function POST(
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

    if (event.status !== "ongoing") {
      return NextResponse.json(
        { ok: false, error: "Only ongoing events can be manually ended" },
        { status: 400 }
      );
    }

    const endedAtIso = new Date().toISOString();
    await manuallyEndRainEvent(eventId, endedAtIso);

    return NextResponse.json({
      ok: true,
      eventId,
      ended_at: endedAtIso,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to end rain event",
      },
      { status: 500 }
    );
  }
}