"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthButtonsProps {
  // Carried through the OAuth/magic-link redirect so /auth/callback can
  // attribute the resulting signup to this invite (see consume_invite).
  inviteToken?: string;
}

function callbackUrl(inviteToken?: string) {
  const url = new URL("/auth/callback", window.location.origin);
  if (inviteToken) url.searchParams.set("invite", inviteToken);
  return url.toString();
}

export function AuthButtons({ inviteToken }: AuthButtonsProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(inviteToken) },
    });
    if (error) setError(error.message);
  }

  async function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(inviteToken) },
    });
    setPending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={signInWithGoogle}
        className="rounded border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50"
      >
        Google로 로그인
      </button>

      <div className="flex items-center gap-3 text-sm text-neutral-400">
        <div className="h-px flex-1 bg-neutral-200" />
        또는
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      {sent ? (
        <p className="text-sm text-neutral-600">
          {email}로 로그인 링크를 보냈습니다. 메일함을 확인해주세요.
        </p>
      ) : (
        <form onSubmit={signInWithEmail} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 주소"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "전송 중…" : "이메일로 로그인 링크 받기"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
