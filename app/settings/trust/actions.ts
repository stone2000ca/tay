"use server";

// Server actions for /settings/trust.
//
// READ-VS-WRITE: WRITE — translates throws into a redirect with ?error=.

import { redirect } from "next/navigation";
import {
  recomputeTrustTier,
  setManualOverride,
  type TrustTier,
} from "@/lib/trust/tier";
import type { TrustCapability } from "@/lib/trust/record";

const CAPS: ReadonlyArray<TrustCapability> = ["send", "reply_send", "book"];
const TIERS: ReadonlyArray<TrustTier> = [
  "tier_0",
  "tier_1",
  "tier_2",
  "tier_3",
];

function parseCapability(input: FormDataEntryValue | null): TrustCapability {
  const s = String(input ?? "");
  if ((CAPS as ReadonlyArray<string>).includes(s)) return s as TrustCapability;
  throw new Error(`invalid capability: ${s}`);
}

function parseTier(input: FormDataEntryValue | null): TrustTier {
  const s = String(input ?? "");
  if ((TIERS as ReadonlyArray<string>).includes(s)) return s as TrustTier;
  throw new Error(`invalid tier: ${s}`);
}

export async function recomputeAction(formData: FormData): Promise<void> {
  let cap: TrustCapability;
  try {
    cap = parseCapability(formData.get("capability"));
  } catch {
    redirect("/settings/trust?error=invalid_capability");
  }
  try {
    const result = await recomputeTrustTier(cap);
    const flash = result.promoted
      ? "promoted"
      : result.demoted
        ? "demoted"
        : result.manualOverride
          ? "noop_manual"
          : "noop";
    redirect(`/settings/trust?capability=${cap}&result=${flash}`);
  } catch (err) {
    console.warn(
      "[settings/trust] recompute failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect(`/settings/trust?capability=${cap}&error=recompute_failed`);
  }
}

export async function setManualOverrideAction(formData: FormData): Promise<void> {
  let cap: TrustCapability;
  let tier: TrustTier;
  let manualOverride: boolean;
  try {
    cap = parseCapability(formData.get("capability"));
    tier = parseTier(formData.get("tier"));
    manualOverride = String(formData.get("manualOverride")) === "true";
  } catch {
    redirect("/settings/trust?error=invalid_input");
  }
  try {
    await setManualOverride({ capability: cap, manualOverride, tier });
    redirect(
      `/settings/trust?capability=${cap}&result=${manualOverride ? "manual_on" : "manual_off"}`,
    );
  } catch (err) {
    console.warn(
      "[settings/trust] manual-override failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect(`/settings/trust?capability=${cap}&error=manual_override_failed`);
  }
}
