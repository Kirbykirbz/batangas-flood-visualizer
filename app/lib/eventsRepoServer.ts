// app/lib/eventsRepoServer.ts

import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export type RainEventStatus = "ongoing" | "resolved" | "cancelled";

export type RainEventRecord = {
  id: number;
  device_id: string;
  started_at: string;
  ended_at: string | null;
  status: RainEventStatus;
  trigger_reason: string | null;
  ended_reason: string | null;
  total_rain_mm: number;
  peak_rain_rate_mmh: number;
  peak_flood_depth_cm: number;
  last_signal_at: string | null;
  last_rain_ticks_total: number | null;
  ended_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listRainEvents(limit = 50): Promise<RainEventRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listRainEvents] ${error.message}`);
  return (data ?? []) as RainEventRecord[];
}

export async function listOngoingRainEvents(): Promise<RainEventRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .select("*")
    .eq("status", "ongoing")
    .order("started_at", { ascending: false });

  if (error) throw new Error(`[listOngoingRainEvents] ${error.message}`);
  return (data ?? []) as RainEventRecord[];
}

export async function listRainEventsByDevice(
  deviceId: string,
  limit = 50
): Promise<RainEventRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .select("*")
    .eq("device_id", deviceId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listRainEventsByDevice] ${error.message}`);
  return (data ?? []) as RainEventRecord[];
}

export async function getRainEventById(
  id: number
): Promise<RainEventRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`[getRainEventById] ${error.message}`);
  return (data ?? null) as RainEventRecord | null;
}

export async function getOngoingRainEvent(
  deviceId: string
): Promise<RainEventRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .select("*")
    .eq("device_id", deviceId)
    .eq("status", "ongoing")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[getOngoingRainEvent] ${error.message}`);
  return (data ?? null) as RainEventRecord | null;
}

export async function createRainEvent(payload: {
  device_id: string;
  started_at: string;
  trigger_reason?: string | null;
  total_rain_mm?: number;
  peak_rain_rate_mmh?: number;
  peak_flood_depth_cm?: number;
  last_signal_at?: string | null;
  last_rain_ticks_total?: number | null;
}) {
  const { data, error } = await supabaseAdmin
    .from("rain_events")
    .insert({
      device_id: payload.device_id,
      started_at: payload.started_at,
      trigger_reason: payload.trigger_reason ?? null,
      total_rain_mm: payload.total_rain_mm ?? 0,
      peak_rain_rate_mmh: payload.peak_rain_rate_mmh ?? 0,
      peak_flood_depth_cm: payload.peak_flood_depth_cm ?? 0,
      last_signal_at: payload.last_signal_at ?? null,
      last_rain_ticks_total: payload.last_rain_ticks_total ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`[createRainEvent] ${error.message}`);
  return data as RainEventRecord;
}

export async function updateRainEvent(
  id: number,
  payload: Partial<
    Pick<
      RainEventRecord,
      | "ended_at"
      | "status"
      | "total_rain_mm"
      | "peak_rain_rate_mmh"
      | "peak_flood_depth_cm"
      | "last_signal_at"
      | "last_rain_ticks_total"
      | "updated_at"
      | "ended_reason"
      | "ended_by_user_id"
    >
  >
) {
  const { error } = await supabaseAdmin
    .from("rain_events")
    .update(payload)
    .eq("id", id);

  if (error) throw new Error(`[updateRainEvent] ${error.message}`);
}

export async function manuallyEndRainEvent(
  id: number,
  endedAtIso: string,
  endedByUserId?: string | null,
  endedReason = "manual_admin_end"
) {
  const { error } = await supabaseAdmin
    .from("rain_events")
    .update({
      status: "resolved",
      ended_at: endedAtIso,
      updated_at: endedAtIso,
      ended_reason: endedReason,
      ended_by_user_id: endedByUserId ?? null,
    })
    .eq("id", id)
    .eq("status", "ongoing");

  if (error) throw new Error(`[manuallyEndRainEvent] ${error.message}`);
}