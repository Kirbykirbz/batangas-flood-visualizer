import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/dashboard");
  }

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) {
    throw new Error(`[requireAdmin] ${roleError.message}`);
  }

  if (!roleRow || roleRow.role !== "admin") {
    redirect("/dashboard");
  }

  return {
    userId,
    role: roleRow.role,
  };
}