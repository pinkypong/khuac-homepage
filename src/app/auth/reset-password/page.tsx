"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Where a recovery link lands, and where its token is redeemed.
 *
 * This used to rely on /auth/callback to establish the session first and then
 * forward here. That hop is gone: carrying "?next=..." made the redirect target
 * fail Supabase's literal match against its allow list, so the mail link went
 * to the Site URL instead and a member asking to reset a password was handed
 * the login screen with no explanation.
 *
 * Both link shapes are handled here for the same reason /auth/callback handles
 * both - a PKCE "code" on the default mail template, a "token_hash" once the
 * template is customised, which is the shape that survives being opened on a
 * different device.
 */
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function redeem() {
      // Read off location rather than useSearchParams: this page is only ever
      // reached by following a link, and it keeps the route out of Suspense.
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        setReady(!error);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setReady(!error);
        return;
      }

      // No token in the URL: either the link was already redeemed and this is a
      // reload, or someone navigated here directly.
      const { data } = await supabase.auth.getSession();
      setReady(data.session !== null);
    }

    redeem();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }
    if (password !== passwordAgain) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  return (
    <main className="mx-auto flex min-h-app max-w-sm flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-2xl font-semibold">비밀번호 재설정</h1>

      {ready === null ? (
        <p className="text-sm text-neutral-500">확인 중…</p>
      ) : !ready ? (
        <>
          <p className="text-sm text-neutral-600">
            링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 재설정 메일을 다시
            받아주세요.
          </p>
          <Link href="/login" className="text-sm underline">
            로그인 화면으로
          </Link>
        </>
      ) : done ? (
        <>
          <p className="text-sm text-neutral-600">비밀번호를 변경했습니다.</p>
          {/* A full navigation, not a client-side one: the session cookie was
              just rewritten and the middleware has to read it on a fresh
              request to route by approval state. */}
          <button
            type="button"
            onClick={() => window.location.assign("/")}
            className="rounded bg-neutral-900 px-4 py-2 text-center font-medium text-white"
          >
            계속하기
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`새 비밀번호 (${MIN_PASSWORD_LENGTH}자 이상)`}
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <input
            type="password"
            required
            value={passwordAgain}
            onChange={(e) => setPasswordAgain(e.target.value)}
            placeholder="새 비밀번호 확인"
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "변경 중…" : "비밀번호 변경"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
