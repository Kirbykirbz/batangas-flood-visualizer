import { supabase } from "@/lib/supabaseClient";

export type PushSubscriptionRecord = {
  id: number;
  user_id: string | null;
  device_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function upsertPushSubscription(payload: {
  user_id?: string | null;
  device_id?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope?: string | null;
}) {
  const { data: existing, error: existingError } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", payload.endpoint)
    .maybeSingle();

  if (existingError) {
    throw new Error(`[upsertPushSubscription:lookup] ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase
      .from("push_subscriptions")
      .update({
        user_id: payload.user_id ?? null,
        device_id: payload.device_id ?? null,
        p256dh: payload.p256dh,
        auth: payload.auth,
        scope: payload.scope ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      throw new Error(`[upsertPushSubscription:update] ${error.message}`);
    }

    return existing.id;
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .insert({
      user_id: payload.user_id ?? null,
      device_id: payload.device_id ?? null,
      endpoint: payload.endpoint,
      p256dh: payload.p256dh,
      auth: payload.auth,
      scope: payload.scope ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`[upsertPushSubscription:insert] ${error.message}`);
  }

  return data.id as number;
}

export async function deactivatePushSubscription(endpoint: string) {
  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("endpoint", endpoint);

  if (error) {
    throw new Error(`[deactivatePushSubscription] ${error.message}`);
  }
}

export async function listActivePushSubscriptions(deviceId?: string | null) {
  let query = supabase
    .from("push_subscriptions")
    .select("*")
    .eq("is_active", true);

  if (deviceId) {
    query = query.eq("device_id", deviceId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[listActivePushSubscriptions] ${error.message}`);
  }

  return (data ?? []) as PushSubscriptionRecord[];
}