"use server";

import { redirect } from "next/navigation";
import { deleteGoogleOAuth } from "@/lib/oauth/persist";
import { appendAudit } from "@/lib/audit/append";
import { setAutoReplyEnabled } from "@/lib/reply/settings";
import { recordTrustEvent } from "@/lib/trust/record";

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

/**
 * v0.9 — Toggle the auto-reply-drafting flag in reply_settings.
 *
 * Read FormData["enabled"] as "true" | "false" string. Audit the toggle
 * and (when flipping ON) record a trust event `override_to_send` —
 * enabling auto-reply is a trust-tier decision the user explicitly made.
 *
 * READ-vs-WRITE: WRITE function — translates throws into a redirect with
 * ?error=. NEVER logs the user's session details.
 */
export async function setAutoReplyAction(formData: FormData): Promise<void> {
  const wanted = String(formData.get("enabled") ?? "") === "true";
  try {
    await setAutoReplyEnabled(wanted);
    await appendAudit({
      action: "reply.auto_reply_toggled",
      payload: { enabled: wanted },
    });
    if (wanted) {
      // Flipping ON is a trust-tier decision. Record so v1.0's tier
      // promotion math can factor "the user explicitly enabled this".
      await recordTrustEvent("reply_send", "override_to_send", {
        action: "auto_reply_enabled",
      });
    } else {
      await recordTrustEvent("reply_send", "override_to_skip", {
        action: "auto_reply_disabled",
      });
    }
  } catch (err) {
    console.warn(
      "[settings] auto-reply toggle failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect("/settings?error=auto_reply_toggle_failed");
  }
  redirect(`/settings?auto_reply=${wanted ? "on" : "off"}`);
}
