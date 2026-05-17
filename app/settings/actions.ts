"use server";

import { redirect } from "next/navigation";
import { deleteGoogleOAuth } from "@/lib/oauth/persist";
import { appendAudit } from "@/lib/audit/append";

/**
 * Server action behind "Disconnect Gmail". Deletes the google_oauth
 * row, appends an audit event, and redirects back with a flash param.
 *
 * READ-vs-WRITE: WRITE function — translates throws into a redirect
 * with ?error=. NEVER logs the OAuth row contents.
 */
export async function disconnectGmailAction(): Promise<void> {
  try {
    await deleteGoogleOAuth();
    await appendAudit({
      action: "oauth.disconnected",
      payload: { provider: "google" },
    });
  } catch (err) {
    console.warn(
      "[settings] disconnect failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect("/settings?error=disconnect_failed");
  }
  redirect("/settings?disconnected=true");
}
