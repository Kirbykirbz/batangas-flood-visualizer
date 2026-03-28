// app/lib/pushRepoServer.ts
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export type PushSubscriptionRecord = {
  id: number;
  user_id: string | null;
  device_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope: "all" | "device" | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function upsertPushSubscriptionServer(payload: {
  user_id?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  scope: "all" | "device";
  targetDeviceIds?: string[];
}) {
  const normalizedTargetIds =
    payload.scope === "device"
      ? Array.from(
          new Set(
            (payload.targetDeviceIds ?? [])
              .map((x) => String(x).trim())
              .filter(Boolean)
          )
        )
      : [];

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert(
      {
        user_id: payload.user_id ?? null,
        endpoint: payload.endpoint,
        p256dh: payload.p256dh,
        auth: payload.auth,
        scope: payload.scope,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`[upsertPushSubscriptionServer] ${error.message}`);
  }

  const subscriptionId = Number(data.id);

  const { error: deleteTargetsError } = await supabaseAdmin
    .from("push_subscription_targets")
    .delete()
    .eq("subscription_id", subscriptionId);

  if (deleteTargetsError) {
    throw new Error(
      `[upsertPushSubscriptionServer:deleteTargets] ${deleteTargetsError.message}`
    );
  }

  if (payload.scope === "device" && normalizedTargetIds.length > 0) {
    const { error: insertTargetsError } = await supabaseAdmin
      .from("push_subscription_targets")
      .insert(
        normalizedTargetIds.map((deviceId) => ({
          subscription_id: subscriptionId,
          device_id: deviceId,
        }))
      );

    if (insertTargetsError) {
      throw new Error(
        `[upsertPushSubscriptionServer:insertTargets] ${insertTargetsError.message}`
      );
    }
  }

  return subscriptionId;
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
    throw new Error(`[deactivatePushSubscriptionServer] ${error.message}`);
  }
}

export async function getPushSubscriptionStatusServer(endpoint: string) {
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, is_active, scope")
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (error) {
    throw new Error(`[getPushSubscriptionStatusServer] ${error.message}`);
  }

  if (!data) return null;

  const subscriptionId = Number(data.id);

  const { data: targets, error: targetsError } = await supabaseAdmin
    .from("push_subscription_targets")
    .select("device_id")
    .eq("subscription_id", subscriptionId)
    .order("device_id", { ascending: true });

  if (targetsError) {
    throw new Error(
      `[getPushSubscriptionStatusServer:targets] ${targetsError.message}`
    );
  }

  return {
    isActive: Boolean(data.is_active),
    scope: data.scope === "device" ? "device" : "all",
    targetDeviceIds: (targets ?? []).map((row) => String(row.device_id)),
  };
}

export async function listActivePushSubscriptionsServer(deviceId?: string | null) {
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[listActivePushSubscriptionsServer] ${error.message}`);
  }

  const subscriptions = (data ?? []) as PushSubscriptionRecord[];

  if (!deviceId) {
    return subscriptions;
  }

  const ids = subscriptions.map((row) => Number(row.id));
  if (ids.length === 0) return [];

  const { data: targets, error: targetsError } = await supabaseAdmin
    .from("push_subscription_targets")
    .select("subscription_id, device_id")
    .in("subscription_id", ids);

  if (targetsError) {
    throw new Error(
      `[listActivePushSubscriptionsServer:targets] ${targetsError.message}`
    );
  }

  const subscriptionIdsMatchingDevice = new Set<number>(
    (targets ?? [])
      .filter((row) => String(row.device_id) === deviceId)
      .map((row) => Number(row.subscription_id))
  );

  return subscriptions.filter((sub) => {
    if (sub.scope === "all") return true;
    return subscriptionIdsMatchingDevice.has(Number(sub.id));
  });
}