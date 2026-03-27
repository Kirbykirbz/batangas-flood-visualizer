import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

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

export async function upsertPushSubscriptionServer(payload: {
  user_id?: string | null;
  device_id?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope?: string | null;
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", payload.endpoint)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `[upsertPushSubscriptionServer:lookup] ${existingError.message}`
    );
  }

  if (existing?.id) {
    const { error } = await supabaseAdmin
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
      throw new Error(
        `[upsertPushSubscriptionServer:update] ${error.message}`
      );
    }

    return existing.id;
  }

  const { data, error } = await supabaseAdmin
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
    throw new Error(
      `[upsertPushSubscriptionServer:insert] ${error.message}`
    );
  }

  return data.id as number;
}

export async function deactivatePushSubscriptionServer(endpoint: string) {
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("endpoint", endpoint);

  if (error) {
    throw new Error(
      `[deactivatePushSubscriptionServer] ${error.message}`
    );
  }
}