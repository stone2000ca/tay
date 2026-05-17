"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sendDraft } from "@/lib/send/orchestrate";

/**
 * Server action for the "Send" button in /queue. Reads draftId from
 * formData, calls sendDraft, revalidates so the row disappears on
 * success. On failure: redirect with ?error= so the user sees a
 * banner on /queue (read in app/queue/page.tsx).
 *
 * v0.8: tightened from v0.7's silent-on-failure behavior — the v0.7
 * impl logged the error and revalidated; the user got no feedback. Now
 * we redirect with the friendly message from the orchestrator.
 */
export async function sendDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) {
    redirect("/queue?error=" + encodeURIComponent("Missing draft id."));
  }
  const result = await sendDraft(draftId);
  if (!result.ok) {
    // Log the friendly error — NEVER the recipient. The orchestrator
    // returns errors that may contain a refresh status code, fine.
    console.warn(`[queue] send failed for draft ${draftId}: ${result.error}`);
    redirect("/queue?error=" + encodeURIComponent(result.error));
  }
  // Success — revalidate so the row disappears.
  revalidatePath("/queue");
}
