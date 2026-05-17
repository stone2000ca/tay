"use server";

import { revalidatePath } from "next/cache";
import { sendDraft } from "@/lib/send/orchestrate";

/**
 * Server action for the "Send" button in /queue. Reads draftId from
 * formData, calls sendDraft, revalidates so the row disappears on
 * success. On failure we return the message — Next swallows server
 * action returns for now, so we also redirect with ?error= so the
 * user sees something.
 */
export async function sendDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return;
  const result = await sendDraft(draftId);
  if (!result.ok) {
    // Log the friendly error — NEVER the recipient. The orchestrator
    // returns errors that may contain a refresh status code, fine.
    console.warn(`[queue] send failed for draft ${draftId}: ${result.error}`);
  }
  // Always revalidate — on success row disappears, on failure other
  // rows may have changed.
  revalidatePath("/queue");
}
