/**
 * Gates every /facilitator/* route behind a single shared password (see
 * FACILITATOR_PASSWORD in .env.example). This is deliberately simple —
 * one password, one cookie, no user accounts — appropriate for an MVP
 * where the worst case is someone messing with test data, not for a real
 * pilot session with real teams. Confirmed with Bjorn (2026-09-16) as the
 * right amount of protection for now.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FACILITATOR_COOKIE_NAME } from "./lib/auth/cookie";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/facilitator/login")) {
    return NextResponse.next();
  }

  const expectedPassword = process.env.FACILITATOR_PASSWORD;
  if (!expectedPassword) {
    // Not configured yet — send to the login page, which explains what to
    // do, rather than either locking everyone out with no explanation or
    // (worse) letting everyone straight in.
    const url = new URL("/facilitator/login", request.url);
    url.searchParams.set("error", "not-configured");
    return NextResponse.redirect(url);
  }

  const cookie = request.cookies.get(FACILITATOR_COOKIE_NAME)?.value;
  if (cookie === expectedPassword) {
    return NextResponse.next();
  }

  const url = new URL("/facilitator/login", request.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/facilitator/:path*"],
};
