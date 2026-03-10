import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const results = searchParams.get("results") ?? "50";

  const channelId = process.env.THINGSPEAK_CHANNEL_ID;
  const readKey = process.env.THINGSPEAK_READ_API_KEY;

  if (!channelId || !readKey) {
    return NextResponse.json(
      { error: "Missing THINGSPEAK_CHANNEL_ID or THINGSPEAK_READ_API_KEY" },
      { status: 500 }
    );
  }

  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readKey}&results=${encodeURIComponent(
    results
  )}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: "ThingSpeak fetch failed", details: text },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}