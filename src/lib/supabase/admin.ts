import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// Service role bypasses RLS. Only use in route handlers / server actions that
// have already checked the caller's permissions themselves.
export function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
