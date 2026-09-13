"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

// Remembering the address turns a returning member's login into typing a
// password, not an address and a password. Per-browser, so a shared machine
// only ever offers whoever used it last - and the password is never stored.
const LAST_EMAIL_KEY = "khuac.lastEmail";

// OAuth completes in the same browser it started in, so it can use the PKCE
// code exchange at /auth/callback.
function oauthCallbackUrl() {
  return new URL("/auth/callback", window.location.origin).toString();
}

// Email links land on the same route. "next" is always present so a custom
// mail template can append "&token_hash=...&type=..." safely later on.
function emailConfirmUrl() {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", "/");
  return url.toString();
}

// Straight to the reset screen, with no query string and no hop through
// /auth/callback. Supabase matches redirect_to against its allow list as
// literal text, so "...?next=/auth/reset-password" failed to match an entry of
// "https://khuac.com/auth/callback" and the link landed on the Site URL - which
// is to say the login screen - instead of the form it promised.
function recoveryUrl() {
  return new URL("/auth/reset-password", window.location.origin).toString();
}

function readLastEmail() {
  // Private windows and locked-down browsers throw rather than return null.
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(email: string) {
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Remembering is a convenience; failing to is not worth surfacing.
  }
}

const MIN_PASSWORD_LENGTH = 8;

// Matches Supabase's default minimum interval between mails to one address.
// Used only when the server did not say how long to wait.
const RESEND_COOLDOWN_SECONDS = 60;

// A too-soon retry comes back as "For security purposes, you can only request
// this after 47 seconds." Reading the number out means the countdown tracks the
// server rather than guessing at it.
function secondsFromRateLimit(message: string): number | null {
  const match = /after (\d+) seconds?/i.exec(message);
  return match ? Number(match[1]) : null;
}

// Google signups have no password to offer, so this cannot name one method.
const ALREADY_REGISTERED =
  "이미 가입된 이메일입니다. 로그인 탭에서 로그인해주세요. Google로 가입하셨다면 Google 버튼을 눌러주세요.";

export function AuthButtons() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Epoch ms, and a ticking clock to compare it against. The interval only runs
  // while a cooldown is live, so an idle login screen is not re-rendering twice
  // a second for nothing.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const isSignup = mode === "signup";

  useEffect(() => {
    if (cooldownUntil === 0) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      // Clearing the deadline re-runs this effect, whose cleanup stops the
      // interval - otherwise it would keep ticking for the rest of the session
      // after a single send.
      if (current >= cooldownUntil) setCooldownUntil(0);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const secondsLeft = cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  const cooling = secondsLeft > 0;

  function startCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
    setCooldownUntil(Date.now() + seconds * 1000);
    setNow(Date.now());
  }

  // Rate limits are the expected answer to an impatient second press, not a
  // fault, so they turn into a countdown rather than a red error line.
  function reportMailError(message: string) {
    const wait = secondsFromRateLimit(message);
    if (wait !== null) {
      startCooldown(wait);
      return;
    }
    if (/rate limit/i.test(message)) {
      setError("메일 발송 한도에 걸렸습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setError(message);
  }

  // Read after mount, not in useState: the server render has no localStorage
  // and a differing initial value would be a hydration mismatch.
  useEffect(() => setEmail(readLastEmail()), []);

  // A mail link - confirming a signup, or finishing a password reset - opens in
  // a new tab, and the session lands there. This tab would otherwise sit
  // unchanged, as though nothing had happened. Only a session arriving *after*
  // mount counts: acting on one already present would fight the middleware,
  // which is what decides where a signed-in member belongs.
  useEffect(() => {
    const supabase = createClient();
    const goHome = () => window.location.assign("/");

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") goHome();
    });

    // Belt and braces: cookie storage has no change event, so this tab learns
    // about the other one when it is looked at again.
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const { data: session } = await supabase.auth.getSession();
      if (session.session) goHome();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setPasswordAgain("");
  }

  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthCallbackUrl(),
        // Signing out of this app does not sign anyone out of Google, so with
        // one account in the browser Google skips its own chooser and returns
        // that same account instantly - there is no way back to the picker.
        // Members share family and lab machines, and an admin testing what a
        // regular member sees needs to switch accounts, so ask every time.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) setError(error.message);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup") {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
        return;
      }
      if (password !== passwordAgain) {
        setError("비밀번호가 서로 다릅니다.");
        return;
      }
    }

    setPending(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: emailConfirmUrl() },
      });
      setPending(false);
      if (error) {
        // Reachable only when email confirmation is off; with it on, Supabase
        // hides a duplicate behind a success response instead (see below).
        if (/already registered|already exists/i.test(error.message)) {
          setError(ALREADY_REGISTERED);
        } else {
          reportMailError(error.message);
        }
        return;
      }

      // Supabase will not say an address is taken - that would let anyone probe
      // which emails have accounts - so a duplicate signup comes back looking
      // like a success, with an empty identities array as the only tell. Left
      // unhandled it tells the member to go and wait for a mail that will never
      // arrive. The club roster is visible to members anyway, so there is
      // nothing here worth protecting at that price.
      if (data.user && data.user.identities?.length === 0) {
        setError(ALREADY_REGISTERED);
        return;
      }

      rememberEmail(email);
      // A confirmation mail leaves no session behind; without confirmation the
      // session is live and the middleware takes it from here.
      if (data.session) {
        window.location.assign("/");
      } else {
        setNotice(
          `${email}로 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 이 화면에서 로그인해주세요.`,
        );
        startCooldown();
        // Signing up is done; what is left to do here is log in. Switching the
        // form says so, and covers the case this tab cannot detect - the link
        // opened on a different device. The password stays filled in because it
        // is the one they will use in a moment.
        setMode("login");
        setPasswordAgain("");
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError(
        error.message.includes("Invalid login credentials")
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : error.message,
      );
      return;
    }
    rememberEmail(email);
    window.location.assign("/");
  }

  // The fallback for anyone who signed up before passwords existed, or who
  // would rather not keep one.
  async function sendMagicLink() {
    if (!email) {
      setError("이메일 주소를 입력해주세요.");
      return;
    }
    setError(null);
    setNotice(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: emailConfirmUrl(),
        // signInWithOtp creates an account when none matches, so a typo on the
        // login tab would quietly enrol a stranger's address and leave junk in
        // the approval queue. Asking to log in means the account already exists.
        shouldCreateUser: isSignup,
      },
    });
    setPending(false);
    if (error) {
      if (/signups not allowed|not allowed for otp/i.test(error.message)) {
        setError("가입되지 않은 이메일입니다. 회원가입 탭에서 먼저 가입해주세요.");
      } else {
        reportMailError(error.message);
      }
    } else {
      rememberEmail(email);
      setNotice(`${email}로 로그인 링크를 보냈습니다. 메일함을 확인해주세요.`);
      startCooldown();
    }
  }

  async function sendReset() {
    if (!email) {
      setError("이메일 주소를 입력해주세요.");
      return;
    }
    setError(null);
    setNotice(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryUrl(),
    });
    setPending(false);
    if (error) {
      reportMailError(error.message);
    } else {
      setNotice(`${email}로 비밀번호 설정 링크를 보냈습니다. 메일함을 확인해주세요.`);
      startCooldown();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex rounded-lg border border-neutral-300 p-0.5" role="tablist">
        {(["login", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (mode === m
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-50")
            }
          >
            {m === "login" ? "로그인" : "회원가입"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        className="rounded border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50"
      >
        {isSignup ? "Google로 가입" : "Google로 로그인"}
      </button>

      <div className="flex items-center gap-3 text-sm text-neutral-400">
        <div className="h-px flex-1 bg-neutral-200" />
        또는
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일 주소"
          autoComplete="email"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isSignup ? `비밀번호 (${MIN_PASSWORD_LENGTH}자 이상)` : "비밀번호"}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {isSignup && (
          <input
            type="password"
            required
            value={passwordAgain}
            onChange={(e) => setPasswordAgain(e.target.value)}
            placeholder="비밀번호 확인"
            autoComplete="new-password"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : isSignup ? "가입하기" : "로그인"}
        </button>
      </form>

      {!isSignup && (
        <div className="flex flex-col gap-1.5 text-xs text-neutral-500">
          <button type="button" onClick={sendReset} disabled={pending || cooling} className="self-start py-1 underline hover:text-neutral-800 disabled:no-underline disabled:opacity-50">
            비밀번호 설정 · 재설정
          </button>
          <button type="button" onClick={sendMagicLink} disabled={pending || cooling} className="self-start py-1 underline hover:text-neutral-800 disabled:no-underline disabled:opacity-50">
            비밀번호 없이 메일로 로그인 링크 받기
          </button>
          {cooling && <p aria-live="polite" className="text-neutral-400">{secondsLeft}초 후 다시 보낼 수 있습니다.</p>}
        </div>
      )}

      {notice && <p className="text-sm text-neutral-600">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
