import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles both Google OAuth and email magic-link sign-in: @supabase/ssr uses
// the PKCE flow for both, so they land here with the same ?code= param.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const invite = searchParams.get("invite");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (invite) {
        // Best-effort: an invalid/expired/exhausted token must not block sign-in,
        // it just means this signup won't be attributed to that invite.
        await supabase.rpc("consume_invite", { p_token: invite });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
