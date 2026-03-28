//app/lib/alertsRepo.ts 

import { supabase } from "@/lib/supabaseClient";

export type AlertRecord = {
  id: number;
  device_id: string;
  rain_event_id: number | null;
  level: "watch" | "warning" | "danger" | "overflow" | "info";
  title: string;
  message: string;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
};

export async function listAlerts(limit = 50): Promise<AlertRecord[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listAlerts] ${error.message}`);
  return (data ?? []) as AlertRecord[];
}

export async function listOpenAlerts(limit = 50): Promise<AlertRecord[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .is("resolved_at", null)
    .order("triggered_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listOpenAlerts] ${error.message}`);
  return (data ?? []) as AlertRecord[];
}

export async function listAlertsByDevice(
  deviceId: string,
  limit = 50
): Promise<AlertRecord[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("device_id", deviceId)
    .order("triggered_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listAlertsByDevice] ${error.message}`);
  return (data ?? []) as AlertRecord[];
}

export async function getLatestUnresolvedAlertByDevice(
  deviceId: string
): Promise<AlertRecord | null> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("device_id", deviceId)
    .is("resolved_at", null)
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[getLatestUnresolvedAlertByDevice] ${error.message}`);
  }

  return (data ?? null) as AlertRecord | null;
}

export async function createAlert(payload: {
  device_id: string;
  rain_event_id?: number | null;
  level: AlertRecord["level"];
  title: string;
  message: string;
}) {
  const { data, error } = await supabase
    .from("alerts")
    .insert({
      device_id: payload.device_id,
      rain_event_id: payload.rain_event_id ?? null,
      level: payload.level,
      title: payload.title,
      message: payload.message,
    })
    .select()
    .single();

  if (error) throw new Error(`[createAlert] ${error.message}`);
  return data as AlertRecord;
}

export async function acknowledgeAlert(id: number) {
  const { error } = await supabase
    .from("alerts")
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`[acknowledgeAlert] ${error.message}`);
}

export async function resolveAlert(id: number, resolvedAt?: string) {
  const { error } = await supabase
    .from("alerts")
    .update({
      resolved_at: resolvedAt ?? new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`[resolveAlert] ${error.message}`);
}