import { Suspense } from "react";
import EventsPageClient from "./EventsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function EventsPageFallback() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4 sm:py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Loading rain events...</div>
        </div>
      </div>
    </div>
  );
}

export default function PublicEventsPage() {
  return (
    <Suspense fallback={<EventsPageFallback />}>
      <EventsPageClient />
    </Suspense>
  );
}