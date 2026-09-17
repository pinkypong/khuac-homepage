import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/auth/redirect";

// Handles both shapes Supabase can send here:
//
//  - ?code=...        PKCE. Used by Google OAuth, and by email links while the
//                     project is on Supabase's default mail templates. Requires
//                     the code verifier cookie, so the link only works in the
//                     browser that started the flow.
//  - ?token_hash=...  verifyOtp. Needs no verifier, so an email link opened on
//                     another device still works. Only reachable once the mail
//                     template is customised, which needs custom SMTP on the
//                     free plan.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeReturnPath(searchParams.get("next"));

  const supabase = await createClient();
  let failed: string | null = null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = error ? `verifyOtp ${error.status}: ${error.message}` : null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = error ? `exchangeCodeForSession ${error.status}: ${error.message}` : null;
  } else {
    failed = "no code or token_hash in callback";
  }

  if (failed) {
    console.error("[auth/callback]", failed);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
