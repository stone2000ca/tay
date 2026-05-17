"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addSuppression,
  removeSuppression,
} from "@/lib/suppression/add";
import { appendAudit } from "@/lib/audit/append";

/**
 * Admin add. Server action posted from the form on /settings/suppression.
 *
 * READ-vs-WRITE: WRITE — addSuppression throws on failure; we catch and
 * redirect with ?error=. Tay gate F: every add appends an audit event.
 */
export async function addSuppressionAction(formData: FormData): Promise<void> {
  const emailRaw = String(formData.get("email") ?? "").trim();
  const sourceRaw = String(formData.get("source") ?? "").trim();
  const source = sourceRaw || "admin-ui:manual-add";

  if (!emailRaw) {
    redirect("/settings/suppression?error=" + encodeURIComponent("Email is required."));
  }
  // Basic sanity — defer real validation to the DB CHECK + the suppression
  // module's input guard. Reject only the obviously malformed.
  if (!emailRaw.includes("@") || emailRaw.length > 320) {
    redirect("/settings/suppression?error=" + encodeURIComponent("That doesn't look like a valid email."));
  }

  try {
    await addSuppression({
      email: emailRaw,
      reason: "manual_add",
      source,
    });
    await appendAudit({
      action: "suppression.added",
      payload: {
        email_lower: emailRaw.toLowerCase(),
        reason: "manual_add",
        source,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[settings.suppression] add failed:", message);
    redirect(
      "/settings/suppression?error=" + encodeURIComponent(message),
    );
  }
  revalidatePath("/settings/suppression");
  redirect("/settings/suppression?added=" + encodeURIComponent(emailRaw.toLowerCase()));
}

/**
 * Admin remove. Server action posted from the per-row Remove button.
 */
export async function removeSuppressionAction(formData: FormData): Promise<void> {
  const emailRaw = String(formData.get("email") ?? "").trim();
  if (!emailRaw) {
    redirect("/settings/suppression?error=" + encodeURIComponent("Email is required."));
  }
  try {
    await removeSuppression(emailRaw);
    await appendAudit({
      action: "suppression.removed",
      payload: {
        email_lower: emailRaw.toLowerCase(),
        source: "admin-ui:manual-remove",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[settings.suppression] remove failed:", message);
    redirect(
      "/settings/suppression?error=" + encodeURIComponent(message),
    );
  }
  revalidatePath("/settings/suppression");
  redirect("/settings/suppression?removed=" + encodeURIComponent(emailRaw.toLowerCase()));
}
