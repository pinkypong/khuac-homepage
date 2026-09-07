import { createBrowserClient } from "@supabase/ssr";

// Referenced literally, not via a helper: Next only inlines NEXT_PUBLIC_* vars
// into the client bundle when the property access is statically visible.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.local.example.",
    );
  }
  return createBrowserClient(url, anonKey);
}
