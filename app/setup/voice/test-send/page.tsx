// /setup/voice/test-send — final voice-cal wizard step.
//
// Tay drafts + sends a real email to the user's own connected mailbox.
// They see it land in their inbox; that confirms the entire pipeline
// (LLM draft → judge → suppression check → channel-specific send →
// audit + trust event) works end-to-end.
//
// The recipient IS the user. Suppression check fires (returns false
// for the user's own email under normal circumstances). The send goes
// through lib/send/orchestrate.ts — the same chokepoint every real
// production send uses. This is intentional: it's the only way the
// test exercises the gates that matter at send time.

import { redirect } from "next/navigation";
import { SupabaseWarning } from "@/components/supabase-warning";
import { getMailboxCredentials } from "@/lib/mailbox/persist";
import { getRubric } from "@/lib/voice/calibrate";
import { TestSendForm } from "./test-send-form";

export default async function TestSendPage() {
  const rubric = await getRubric();
  if (!rubric) {
    redirect("/setup/voice");
  }

  const mailbox = await getMailboxCredentials();
  if (!mailbox) {
    redirect("/setup/mailbox");
  }

  return (
    <>
      <SupabaseWarning />
      <main className="min-h-dvh flex items-start justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Send a test email to yourself
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Connected mailbox: <code className="text-xs">{mailbox.emailAddress}</code>
            </p>
            <p className="mt-4 text-sm text-gray-600">
              Tay will draft a short email to your own address using the
              rubric you just confirmed, run it through the judge, and send
              via{" "}
              {mailbox.kind === "oauth" ? "the Gmail API" : "your SMTP relay"}.
              You should see it land in your inbox within a minute.
            </p>
          </div>

          <TestSendForm recipientEmail={mailbox.emailAddress} />
        </div>
      </main>
    </>
  );
}
