import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { middleware } from "./middleware";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
vi.mock("@/lib/supabase/middleware", () => ({ createMiddlewareClient: vi.fn() }));

function session(role: string | null, signedIn = true) {
  const response = NextResponse.next();
  response.cookies.set("refreshed-session", "new-token", { httpOnly: true, path: "/" });
  const supabase = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user" } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: role ? { role } : null }) }) }) }) };
  vi.mocked(createMiddlewareClient).mockReturnValue({ supabase, getResponse: () => response } as never);
}
beforeEach(() => vi.clearAllMocks());
it("preserves refreshed cookies when redirecting an approved login to home", async () => {
  session("member");
  const response = await middleware(new NextRequest("http://localhost:3100/login"));
  expect(response.headers.get("location")).toBe("http://localhost:3100/");
  expect(response.cookies.get("refreshed-session")?.value).toBe("new-token");
});
it("preserves cookie clearing/updates on the unauthenticated redirect", async () => {
  session(null, false);
  const response = await middleware(new NextRequest("http://localhost:3100/map"));
  expect(response.status).toBe(307);
  expect(response.cookies.get("refreshed-session")?.value).toBe("new-token");
});
it.each(["/auth/callback?code=example", "/privacy"])("allows pending members to access %s", async (path) => {
  session("pending");
  expect((await middleware(new NextRequest(`http://localhost:3100${path}`))).headers.get("location")).toBeNull();
});
it("still blocks pending members from maps and members from admin", async () => {
  session("pending");
  expect((await middleware(new NextRequest("http://localhost:3100/map"))).headers.get("location")).toContain("/pending-approval");
  session("member");
  expect((await middleware(new NextRequest("http://localhost:3100/admin/members"))).headers.get("location")).toBe("http://localhost:3100/");
});
