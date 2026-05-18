"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import {
  extractProspectFromDescription,
  type ExtractedProspect,
} from "@/lib/prospect/extract";
import { upsertProspect } from "@/lib/draft/persist";
import { markSetupComplete } from "@/lib/app-config";
import { appendAudit } from "@/lib/audit/append";

export type ExtractActionResult =
  | { ok: true; prospect: ExtractedProspect }
  | { ok: false; error: string };

export type SaveActionResult =
  | { ok: true; prospectId: string }
  | { ok: false; error: string };

const NAME_MAX = 200;
const COMPANY_MAX = 200;
const EMAIL_MAX = 320;
const NOTES_MAX = 2000;

export async function extractProspectAction(args: {
  description: string;
}): Promise<ExtractActionResult> {
  await ensureSchema();
  const result = await extractProspectFromDescription({
    description: args.description,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, prospect: result.prospect };
}

export async function saveProspectAction(args: {
  full_name: string;
  company: string;
  email?: string;
  notes?: string;
}): Promise<SaveActionResult> {
  await ensureSchema();

  // Server-side validation — never trust the client form. The client
  // already trims/maxlengths but redo it here so direct API hits can't
  // bypass.
  const full_name = (args.full_name ?? "").trim();
  const company = (args.company ?? "").trim();
  const email = (args.email ?? "").trim();
  const notes = (args.notes ?? "").trim();

  if (full_name.length === 0 || full_name.length > NAME_MAX) {
    return { ok: false, error: `Prospect name is required (≤${NAME_MAX} chars).` };
  }
  if (company.length === 0 || company.length > COMPANY_MAX) {
    return { ok: false, error: `Company is required (≤${COMPANY_MAX} chars).` };
  }
  if (email.length > EMAIL_MAX) {
    return { ok: false, error: `Email is too long (max ${EMAIL_MAX} chars).` };
  }
  if (email.length > 0 && !looksLikeEmail(email)) {
    return { ok: false, error: "Email doesn't look right. Leave blank or fix it." };
  }
  if (notes.length > NOTES_MAX) {
    return { ok: false, error: `Notes are too long (max ${NOTES_MAX} chars).` };
  }

  let prospectId: string;
  try {
    const result = await upsertProspect({
      full_name,
      company,
      notes: notes.length > 0 ? notes : undefined,
      email: email.length > 0 ? email : undefined,
    });
    prospectId = result.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save prospect: ${message}` };
  }

  // Last-step wizard marker — flip setup_complete so /app/page.tsx
  // stops routing the user through the wizard sub-flow on next visit.
  try {
    await markSetupComplete();
    await appendAudit({
      action: "setup.completed",
      payload: { prospectId },
    });
  } catch (err) {
    // Non-fatal: prospect saved, but completion flag failed. User can
    // re-trigger by re-visiting; logging is enough.
    console.warn(
      "[prospect-quickadd] markSetupComplete failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return { ok: true, prospectId };
}

function looksLikeEmail(s: string): boolean {
  // Tiny pragmatic check — not RFC-compliant but enough to catch
  // obvious typos. Full validation happens on send.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
