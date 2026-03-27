import { supabase } from "@/lib/supabaseClient";

export type FeedbackMessageRecord = {
  id: number;
  name: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  status: "new" | "read" | "resolved";
  created_at: string;
  resolved_at: string | null;
};

export async function listFeedbackMessages(limit = 50): Promise<FeedbackMessageRecord[]> {
  const { data, error } = await supabase
    .from("feedback_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[listFeedbackMessages] ${error.message}`);
  return (data ?? []) as FeedbackMessageRecord[];
}

export async function createFeedbackMessage(payload: {
  name?: string | null;
  email?: string | null;
  subject?: string | null;
  message: string;
}) {
  const { data, error } = await supabase
    .from("feedback_messages")
    .insert({
      name: payload.name ?? null,
      email: payload.email ?? null,
      subject: payload.subject ?? null,
      message: payload.message,
    })
    .select()
    .single();

  if (error) throw new Error(`[createFeedbackMessage] ${error.message}`);
  return data as FeedbackMessageRecord;
}

export async function updateFeedbackStatus(
  id: number,
  status: FeedbackMessageRecord["status"]
) {
  const payload =
    status === "resolved"
      ? { status, resolved_at: new Date().toISOString() }
      : { status };

  const { error } = await supabase
    .from("feedback_messages")
    .update(payload)
    .eq("id", id);

  if (error) throw new Error(`[updateFeedbackStatus] ${error.message}`);
}