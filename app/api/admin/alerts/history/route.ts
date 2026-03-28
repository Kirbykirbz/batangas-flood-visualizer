// app/api/admin/alerts/history/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/adminAuthServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type AlertLevel = "watch" | "warning" | "danger" | "overflow" | "info";

type SensorJoinRow = {
  name: string | null;
  zone_label: string | null;
};

type AlertHistoryRow = {
  id: number;
  device_id: string;
  rain_event_id: number | null;
  level: AlertLevel;
  title: string;
  message: string;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  sensors: SensorJoinRow[] | null;
};

type AlertHistoryItem = {
  id: number;
  deviceId: string;
  sensorName: string;
  zoneLabel: string | null;
  rainEventId: number | null;
  level: AlertLevel;
  title: string;
  message: string;
  triggeredAt: string;
  resolvedAt: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

type AlertHistorySuccessResponse = {
  ok: true;
  items: AlertHistoryItem[];
};

type AlertHistoryErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(
  req: NextRequest
): Promise<NextResponse<AlertHistorySuccessResponse | AlertHistoryErrorResponse>> {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);

    const deviceId = searchParams.get("deviceId")?.trim() || "";
    const level = searchParams.get("level")?.trim() || "";
    const openOnly = searchParams.get("openOnly") === "true";
    const acknowledgedParam = searchParams.get("acknowledged");

    const parsedLimit = Number(searchParams.get("limit") || "50");
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 200)
    );

    let query = supabaseAdmin
      .from("alerts")
      .select(
        `
        id,
        device_id,
        rain_event_id,
        level,
        title,
        message,
        triggered_at,
        resolved_at,
        acknowledged,
        acknowledged_at,
        sensors (
          name,
          zone_label
        )
        `
      )
      .order("triggered_at", { ascending: false })
      .limit(limit);

    if (deviceId) {
      query = query.eq("device_id", deviceId);
    }

    if (level) {
      query = query.eq("level", level);
    }

    if (openOnly) {
      query = query.is("resolved_at", null);
    }

    if (acknowledgedParam === "true") {
      query = query.eq("acknowledged", true);
    } else if (acknowledgedParam === "false") {
      query = query.eq("acknowledged", false);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[alerts/history] ${error.message}`);
    }

    const rows = (data ?? []) as unknown as AlertHistoryRow[];

    const items: AlertHistoryItem[] = rows.map((row) => {
      const sensor = row.sensors?.[0] ?? null;

      return {
        id: row.id,
        deviceId: row.device_id,
        sensorName: sensor?.name ?? row.device_id,
        zoneLabel: sensor?.zone_label ?? null,
        rainEventId: row.rain_event_id,
        level: row.level,
        title: row.title,
        message: row.message,
        triggeredAt: row.triggered_at,
        resolvedAt: row.resolved_at,
        acknowledged: row.acknowledged,
        acknowledgedAt: row.acknowledged_at,
      };
    });

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load alert history",
      },
      { status: 500 }
    );
  }
}