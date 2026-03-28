// app/lib/alertsRepoServer.ts

import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { AlertLevel } from "@/app/lib/alertsShared";

export type AlertRecordServer = {
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
  created_at: string;
};

export async function listAlertsServer(params?: {
  limit?: number;
  deviceId?: string;
  level?: AlertLevel;
  openOnly?: boolean;
  acknowledged?: boolean;
}) {
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 200));

  let query = supabaseAdmin
    .from("alerts")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(limit);

  if (params?.deviceId) {
    query = query.eq("device_id", params.deviceId);
  }

  if (params?.level) {
    query = query.eq("level", params.level);
  }

  if (params?.openOnly) {
    query = query.is("resolved_at", null);
  }

  if (typeof params?.acknowledged === "boolean") {
    query = query.eq("acknowledged", params.acknowledged);
  }

  const { data, error } = await query;

  if (error) throw new Error(`[listAlertsServer] ${error.message}`);
  return (data ?? []) as AlertRecordServer[];
}

export async function getLatestUnresolvedAlertByDeviceServer(deviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("alerts")
    .select("*")
    .eq("device_id", deviceId)
    .is("resolved_at", null)
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[getLatestUnresolvedAlertByDeviceServer] ${error.message}`);
  }

  return (data ?? null) as AlertRecordServer | null;
}

export async function createAlertServer(payload: {
  device_id: string;
  rain_event_id?: number | null;
  level: AlertLevel;
  title: string;
  message: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("alerts")
    .insert({
      device_id: payload.device_id,
      rain_event_id: payload.rain_event_id ?? null,
      level: payload.level,
      title: payload.title,
      message: payload.message,
    })
    .select("*")
    .single();

  if (error) throw new Error(`[createAlertServer] ${error.message}`);
  return data as AlertRecordServer;
}

export async function acknowledgeAlertServer(id: number) {
  const { error } = await supabaseAdmin
    .from("alerts")
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`[acknowledgeAlertServer] ${error.message}`);
}

export async function resolveAlertServer(id: number, resolvedAt?: string) {
  const { error } = await supabaseAdmin
    .from("alerts")
    .update({
      resolved_at: resolvedAt ?? new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`[resolveAlertServer] ${error.message}`);
}