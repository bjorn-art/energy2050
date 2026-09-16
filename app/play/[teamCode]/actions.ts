"use server";

import { revalidatePath } from "next/cache";
import { createInvestment } from "../../../lib/db/repository";

export async function investAction(formData: FormData) {
  const teamId = formData.get("teamId");
  const teamCode = formData.get("teamCode");
  const assetId = formData.get("assetId");
  const financingOptionIdRaw = formData.get("financingOptionId");
  const offtakeOptionIdRaw = formData.get("offtakeOptionId");

  if (typeof teamId !== "string" || typeof assetId !== "string") {
    throw new Error("Team and asset are required.");
  }

  const financingOptionId =
    typeof financingOptionIdRaw === "string" && financingOptionIdRaw.length > 0 ? financingOptionIdRaw : null;
  const offtakeOptionId =
    typeof offtakeOptionIdRaw === "string" && offtakeOptionIdRaw.length > 0 ? offtakeOptionIdRaw : null;

  await createInvestment({ teamId, assetId, financingOptionId, offtakeOptionId });

  if (typeof teamCode === "string") {
    revalidatePath(`/play/${teamCode}`);
  }
}
