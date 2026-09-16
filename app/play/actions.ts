"use server";

import { redirect } from "next/navigation";

export async function joinAction(formData: FormData) {
  const code = formData.get("code");
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error("Enter a team code.");
  }
  // Whether the code actually matches a team is checked on the destination
  // page (/play/[teamCode]), which shows a friendly message rather than a
  // generic 404 if it doesn't — kept here as a plain redirect rather than a
  // lookup-then-redirect so a typo doesn't throw from this action.
  redirect(`/play/${encodeURIComponent(code.trim().toUpperCase())}`);
}
