"use server";

import { revalidatePath } from "next/cache";
import { chooseAssetIntervention, createInvestment, respondToCsr } from "../../../lib/db/repository";

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

export async function respondCsrAction(formData: FormData) {
  const teamId = formData.get("teamId");
  const teamCode = formData.get("teamCode");
  const interventionEffectId = formData.get("interventionEffectId");
  const choiceId = formData.get("choiceId");
  const amountRaw = formData.get("amount");

  if (typeof teamId !== "string" || typeof interventionEffectId !== "string" || typeof choiceId !== "string") {
    throw new Error("A team, event, and choice are required.");
  }

  const amount = typeof amountRaw === "string" && amountRaw.trim().length > 0 ? Number(amountRaw) : 0;
  if (Number.isNaN(amount)) throw new Error("Enter a valid amount.");

  await respondToCsr({ teamId, interventionEffectId, choiceId, amount });

  if (typeof teamCode === "string") {
    revalidatePath(`/play/${teamCode}`);
  }
}

export async function chooseAssetInterventionAction(formData: FormData) {
  const teamId = formData.get("teamId");
  const teamCode = formData.get("teamCode");
  const assetInterventionId = formData.get("assetInterventionId");

  if (typeof teamId !== "string" || typeof assetInterventionId !== "string") {
    throw new Error("A team and a choice are required.");
  }

  await chooseAssetIntervention({ teamId, assetInterventionId });

  if (typeof teamCode === "string") {
    revalidatePath(`/play/${teamCode}`);
  }
}
