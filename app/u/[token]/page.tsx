// /u/[token] — recipient-facing unsubscribe handler.
//
// This route is the ONLY place a non-Tay-user touches a Tay page. Design
// rules:
//   1. NO authentication. Recipients aren't users.
//   2. NO information leakage. The page renders ONE of three messages:
//        - "You're unsubscribed." (first valid click)
//        - "You're already unsubscribed." (replay click)
//        - "Link expired or invalid." (bad/expired/tampered token)
//      It NEVER renders: the recipient's email address back to them,
//      anything about other prospects, the Tay user's account, the
//      company, the deal, the suppression list, or any branding that
//      could be used to phish.
//   3. NO POST request needed. A GET on the signed token completes the
//      unsubscribe — this is fine because the token IS the proof of
//      consent (the recipient could only have gotten it from an email
//      we sent them).
//   4. Degraded-state matrix:
//      | State                       | Behavior                              |
//      |-----------------------------|---------------------------------------|
//      | TAY_OAUTH_SECRET missing    | "expired or invalid" (cannot verify) |
//      | Supabase env missing        | "expired or invalid" (cannot record) |
//      | Token signature bad         | "expired or invalid"                  |
//      | Token expired               | "expired or invalid"                  |
//      | First valid click           | "you're unsubscribed" + DB write      |
//      | Replay click on same token  | "you're already unsubscribed"         |
//      | DB write throws             | "expired or invalid" (don't lie)      |
//
// Tay gate F: every successful add OR confirmed-replay calls appendAudit
// with action "user.unsubscribed". The payload includes the lowercased
// email (the redactor will mask "email_lower" since it contains the
// "email" substring — confirmed by lib/audit/append.test.ts).

import { addSuppression } from "@/lib/suppression/add";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe/token";
import { appendAudit } from "@/lib/audit/append";
import { ensureSchema } from "@/lib/supabase/migrate";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Outcome = "unsubscribed" | "already" | "invalid";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const outcome = await processUnsubscribe(token);
  return renderOutcome(outcome);
}

async function processUnsubscribe(token: string): Promise<Outcome> {
  // Bootstrap schema in case this is the first request on cold-start.
  // ensureSchema is a no-op when Supabase isn't wired (returns skipped).
  await ensureSchema();

  // Verify the token. Throws ONLY if TAY_OAUTH_SECRET is missing — we
  // catch and render "invalid" rather than leaking the misconfig to
  // the recipient.
  let verified: ReturnType<typeof verifyUnsubscribeToken>;
  try {
    verified = verifyUnsubscribeToken(token);
  } catch {
    return "invalid";
  }
  if (!verified.ok) return "invalid";

  // If Supabase is unconfigured we can't record the unsubscribe. Render
  // "invalid" rather than success (would be a lie — the recipient
  // would think they're off the list).
  if (!hasSupabaseEnv()) {
    return "invalid";
  }

  try {
    await addSuppression({
      email: verified.email,
      reason: "user_unsubscribe",
      source: "unsubscribe-link",
    });
  } catch (err) {
    console.warn(
      "[unsubscribe] addSuppression failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "invalid";
  }

  // addSuppression is idempotent (upsert with ignoreDuplicates). We
  // can't easily tell first-add vs replay from the upsert result, so we
  // distinguish by a follow-up read — keeps the UI message honest. If
  // the read fails, fall through to "unsubscribed" (worst case the
  // user sees "you're unsubscribed" twice — still correct).
  const alreadyExisted = await wasPreviouslySuppressed(
    verified.email,
  );
  const outcome: Outcome = alreadyExisted ? "already" : "unsubscribed";

  // Audit (Tay gate F). Always append on a valid token even for replay
  // — the audit chain captures the user's intent each time. Payload
  // uses email_lower so the redactor masks it ("email" substring match).
  await appendAudit({
    action: "user.unsubscribed",
    payload: {
      email_lower: verified.email.toLowerCase(),
      source: "unsubscribe-link",
      replay: alreadyExisted,
    },
  });

  return outcome;
}

// Heuristic: a row that was added before the *very recent* add (more than
// 5 seconds ago) was almost certainly there before this click. The
// upsert+ignoreDuplicates is what gives us idempotence; this read just
// classifies the UX.
async function wasPreviouslySuppressed(email: string): Promise<boolean> {
  const { listSuppressions } = await import("@/lib/suppression/add");
  const entries = await listSuppressions(500);
  const match = entries.find(
    (e) => e.email === email.toLowerCase(),
  );
  if (!match) return false;
  const ageMs = Date.now() - new Date(match.addedAt).getTime();
  return ageMs > 5_000;
}

function renderOutcome(outcome: Outcome) {
  const { title, message } =
    outcome === "unsubscribed"
      ? {
          title: "You're unsubscribed.",
          message:
            "You won't receive any further emails from this sender. Thanks for letting us know.",
        }
      : outcome === "already"
        ? {
            title: "You're already unsubscribed.",
            message:
              "No further action needed. You won't receive any further emails.",
          }
        : {
            title: "Link expired or invalid.",
            message:
              "If you want to opt out, reply to any email with STOP and we'll take you off the list.",
          };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          {title}
        </h1>
        <p className="mt-3 text-sm text-gray-600">{message}</p>
      </div>
    </main>
  );
}
