import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import type { MemberRole } from "@/types/database";

const PENDING_APPROVAL_PATH = "/pending-approval";
const LOGIN_PATH = "/login";

// Paths reachable without a session (or, for /login, without redirect logic).
// /join/<token> is the invite landing page shared via KakaoTalk/Band - it
// must be visible to signed-out visitors, that's the whole point of it.
const PUBLIC_PATHS = [LOGIN_PATH, "/auth/callback", "/join"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, getResponse } = createMiddlewareClient(request);

  // Required first: refreshes the session cookie before any other supabase call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (!user) {
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      return getResponse();
    }
    return redirectTo(LOGIN_PATH);
  }

  // Logged in: figure out approval state (self-row read is always allowed by RLS).
  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();

  const role = member?.role as MemberRole | undefined;
  const isApproved = role === "member" || role === "admin";

  if (pathname.startsWith(LOGIN_PATH)) {
    return redirectTo(isApproved ? "/" : PENDING_APPROVAL_PATH);
  }

  if (pathname.startsWith(PENDING_APPROVAL_PATH)) {
    return isApproved ? redirectTo("/") : getResponse();
  }

  if (!isApproved) {
    return redirectTo(PENDING_APPROVAL_PATH);
  }

  if (pathname.startsWith("/admin") && role !== "admin") {
    return redirectTo("/");
  }

  return getResponse();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
