import { supabase } from "@/lib/supabaseClient";

export async function signInAdmin(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  const userId = data.user?.id;

  if (!userId) {
    await supabase.auth.signOut();
    throw new Error("No authenticated user was returned.");
  }

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) {
    await supabase.auth.signOut();
    throw new Error(roleError.message);
  }

  if (!roleRow || roleRow.role !== "admin") {
    await supabase.auth.signOut();
    throw new Error("This account is not authorized for admin access.");
  }

  return data;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (error.message?.toLowerCase().includes("auth session missing")) {
      return null;
    }
    throw new Error(error.message);
  }

  return user;
}

export async function getCurrentSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw new Error(error.message);
  return session;
}

export async function getCurrentUserRole() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    if (userError.message?.toLowerCase().includes("auth session missing")) {
      return null;
    }
    throw new Error(userError.message);
  }

  if (!user) return null;

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.role ?? null;
}