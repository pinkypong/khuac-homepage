import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import type { MemberRole } from "@/types/database";

const PENDING_APPROVAL_PATH = "/pending-approval";
const LOGIN_PATH = "/login";
const RESET_PASSWORD_PATH = "/auth/reset-password";

// Paths reachable without a session (or, for /login, without redirect logic).
const PUBLIC_PATHS = [LOGIN_PATH, "/auth/callback", RESET_PASSWORD_PATH, "/privacy"];

// Viewable without an account, and even while an account is still pending -
// "일반 웹페이지처럼" was the ask: open the map and see the club's albums,
// no sign-up required. Creating or editing one still needs an approved
// account; every server action enforces that itself (requireApprovedMember),
// independent of this middleware, and the page hides those controls for
// whoever this lets through (see the canEdit prop from map/page.tsx down).
// Deliberately not photos or the member roster - locations_select and
// hikes_select were opened for this in RLS, photos_select was not.
const PUBLIC_READ_PATHS = ["/map"];

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
    const response = NextResponse.redirect(url);
    // Refresh/clear cookies must survive redirects as well as page responses.
    for (const cookie of getResponse().cookies.getAll()) response.cookies.set(cookie);
    return response;
  };

  if (!user) {
    if ([...PUBLIC_PATHS, ...PUBLIC_READ_PATHS].some((p) => pathname.startsWith(p))) {
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

  // Pending members still need to redeem login links and read the privacy policy.
  if (pathname === "/auth/callback" || pathname === "/privacy") return getResponse();

  // A recovery link signs you in before you choose the new password, so this
  // runs with a live session. It has to stay reachable even while approval is
  // pending - forgetting a password has nothing to do with being approved.
  if (pathname.startsWith(RESET_PASSWORD_PATH)) {
    return getResponse();
  }

  if (pathname.startsWith(LOGIN_PATH)) {
    return redirectTo(isApproved ? "/" : PENDING_APPROVAL_PATH);
  }

  if (pathname.startsWith(PENDING_APPROVAL_PATH)) {
    return isApproved ? redirectTo("/") : getResponse();
  }

  if (!isApproved) {
    // A pending member gets at least what a stranger gets - waiting for
    // approval should not mean seeing less of the club's own site.
    if (PUBLIC_READ_PATHS.some((p) => pathname.startsWith(p))) return getResponse();
    return redirectTo(PENDING_APPROVAL_PATH);
  }

  if (pathname.startsWith("/admin") && role !== "admin") {
    return redirectTo("/");
  }

  return getResponse();
}

// api/images is excluded by path rather than by extension. The extension list
// below cannot cover it: an iPhone uploads HEIC, buildStorageKey keeps whatever
// extension the file had, and a thumbnail URL therefore ends in .heic - so every
// photo in a gallery was running the full middleware, two Supabase round trips
// each, before reaching a route that authenticates itself anyway
// (requireApprovedMember at the top of app/api/images/[...key]/route.ts).
export const config = {
  matcher: [
    "/((?!api/images|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
