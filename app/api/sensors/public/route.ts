import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type PublicSensorItem = {
  id: string;
  name: string;
  zoneLabel: string | null;
};

type PublicSensorsResponse =
  | {
      ok: true;
      sensors: PublicSensorItem[];
    }
  | {
      ok: false;
      error: string;
    };

export async function GET(): Promise<NextResponse<PublicSensorsResponse>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("sensors")
      .select("id, name, zone_label")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`[sensors/public] ${error.message}`);
    }

    const sensors: PublicSensorItem[] = (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      zoneLabel:
        typeof row.zone_label === "string" ? row.zone_label : null,
    }));

    return NextResponse.json({
      ok: true,
      sensors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load public sensors",
      },
      { status: 500 }
    );
  }
}