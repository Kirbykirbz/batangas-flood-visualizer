import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // keep server-only
  );

  // Adjust table/column names to your schema
  const { data, error } = await supabase
    .from("sensor_readings")
    .select("timestamp, rain_mm_hr, flood_depth_cm, sensor_code")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    timestamp: data?.timestamp ?? null,
    rain_mm_hr: data?.rain_mm_hr ?? 0,
    flood_depth_cm: data?.flood_depth_cm ?? 0,
    sensor_code: data?.sensor_code ?? null,
  });
}