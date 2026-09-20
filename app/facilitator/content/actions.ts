"use server";

import { revalidatePath } from "next/cache";
import { updateAssetBasics, updateInterventionText } from "../../../lib/db/repository";

export async function updateInterventionAction(formData: FormData) {
  const id = formData.get("id");
  const subject = formData.get("subject");
  const message = formData.get("message");
  if (typeof id !== "string") {
    throw new Error("Missing event id.");
  }
  await updateInterventionText({
    id,
    subject: typeof subject === "string" && subject.trim().length > 0 ? subject : null,
    message: typeof message === "string" && message.trim().length > 0 ? message : null,
  });
  revalidatePath("/facilitator/content/events");
}

export async function updateAssetAction(formData: FormData) {
  const id = formData.get("id");
  const name = formData.get("name");
  const description = formData.get("description");
  const risk = formData.get("risk");
  const minimumAccessCost = formData.get("minimumAccessCost");
  if (typeof id !== "string" || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Missing asset id or name.");
  }
  const riskNumber = typeof risk === "string" && risk.trim() !== "" ? Number(risk) : 0;
  const accessCostNumber =
    typeof minimumAccessCost === "string" && minimumAccessCost.trim() !== "" ? Number(minimumAccessCost) : 0;
  if (!Number.isFinite(riskNumber) || !Number.isFinite(accessCostNumber)) {
    throw new Error("Risk and access cost must be numbers.");
  }
  // One paragraph per line, blank lines dropped — matches how
  // description: string[] is rendered (one <div> per paragraph) on the
  // team's market screen.
  const descriptionParagraphs =
    typeof description === "string"
      ? description
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];

  await updateAssetBasics({
    id,
    name: name.trim(),
    description: descriptionParagraphs,
    risk: riskNumber,
    minimumAccessCost: accessCostNumber,
  });
  revalidatePath("/facilitator/content/assets");
}
