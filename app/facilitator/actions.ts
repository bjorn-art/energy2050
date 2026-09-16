"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addTeam, advanceSessionYear, createSession } from "../../lib/db/repository";

export async function createSessionAction(formData: FormData) {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Session name is required.");
  }
  const sessionId = await createSession(name.trim());
  redirect(`/facilitator/session/${sessionId}`);
}

export async function addTeamAction(formData: FormData) {
  const sessionId = formData.get("sessionId");
  const name = formData.get("name");
  if (typeof sessionId !== "string" || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Session and team name are required.");
  }
  await addTeam(sessionId, name.trim());
  revalidatePath(`/facilitator/session/${sessionId}`);
}

export async function advanceYearAction(formData: FormData) {
  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string") {
    throw new Error("Session is required.");
  }
  await advanceSessionYear(sessionId);
  revalidatePath(`/facilitator/session/${sessionId}`);
}
