"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FACILITATOR_COOKIE_NAME } from "../../../lib/auth/cookie";

export async function loginAction(formData: FormData) {
  const password = formData.get("password");
  const next = formData.get("next");
  const nextPath = typeof next === "string" && next.startsWith("/facilitator") ? next : "/facilitator";

  const expected = process.env.FACILITATOR_PASSWORD;
  if (!expected) {
    redirect("/facilitator/login?error=not-configured");
  }
  if (typeof password !== "string" || password.length === 0 || password !== expected) {
    redirect(`/facilitator/login?error=wrong-password&next=${encodeURIComponent(nextPath)}`);
  }

  cookies().set(FACILITATOR_COOKIE_NAME, expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours — long enough for one facilitated session, short enough that a stale cookie doesn't linger forever
  });

  redirect(nextPath);
}

export async function logoutAction() {
  cookies().delete(FACILITATOR_COOKIE_NAME);
  redirect("/facilitator/login");
}
