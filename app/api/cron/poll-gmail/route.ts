// GET /api/cron/poll-gmail — Vercel Cron trigger for v0.9 reply polling.
//
// v1.1.1 fix-pass: the cron secret is NOT derived. Vercel Cron's auth
// mechanism uses `process.env.CRON_SECRET` directly — Vercel auto-sets
// this env var for any project that has a `vercel.json` cron config (or
// honors the user-set value if present). HKDF-deriving a value that
// needs to match an external system would produce a 401-loop on every
// cron tick.
//
// We still call ensureSchema() first because the migrator needs to run
// at least once and the cron route is a reliable trigger. Order:
//
//   1. ensureSchema()  — creates instance_secrets / cursor tables
//   2. Read process.env.CRON_SECRET (Vercel-managed)
//   3. Verify Authorization: Bearer ${secret} via timingSafeEqual
//   4. Run the poller
//
// If step 1 fails: 503 (the deploy is broken, not the caller). If
// CRON_SECRET is unset and no Authorization header was sent: 503
// (deployment misconfig — friendly hint). If the header is wrong: 401.
//
// Degraded-state matrix:
//   | State                                  | Behavior                       |
//   |----------------------------------------|--------------------------------|
//   | ensureSchema fails                     | 503 schema_unavailable         |
//   | CRON_SECRET unset + no auth header     | 503 cron_secret_not_configured |
//   | Authorization header missing/wrong     | 401 unauthorized               |
//   | All checks pass → Supabase missing     | 200, {0,0,0}                   |
//   | All checks pass → Gmail not connected  | 200, {0,0,1}                   |
//   | All checks pass → first poll           | 200, {0,0,0} (cursor seeded)   |
//   | All checks pass → cursor poll          | 200, {N,S,E} per poll          |
//
// Logging policy: route logs ONLY operational counts. NEVER reply bodies.

import { timingSafeEqual } from "node:crypto";
import { pollGmail } from "@/lib/reply/poll";
import { ensureSchema } from "@/lib/supabase/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // -- 1. Schema (creates instance_secrets if it's missing) ---------------
  const migrate = await ensureSchema();
  if (migrate.error) {
    console.warn("[cron/poll-gmail] schema bootstrap failed:", migrate.error);
    return new Response(JSON.stringify({ error: "schema_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // -- 2. Read CRON_SECRET from env ---------------------------------------
  // Vercel auto-sets this env var for any project with a vercel.json cron
  // config. Non-Vercel deploys must set it manually like any other env
  // var. If it's missing AND the caller sent no Authorization header,
  // emit a friendly 503 instead of a 401 — the request was almost
  // certainly Vercel Cron and the misconfig is on our side.
  const expected = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (expected.length === 0 && auth.length === 0) {
    return new Response(
      JSON.stringify({
        error: "cron_secret_not_configured",
        hint: "Vercel auto-sets CRON_SECRET when a cron is configured in vercel.json. For non-Vercel deploys, set this env var manually.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // -- 3. Verify Authorization header (constant-time) ---------------------
  const expectedHeader = `Bearer ${expected}`;
  const authBuf = Buffer.from(auth, "utf8");
  const expectedBuf = Buffer.from(expectedHeader, "utf8");
  // timingSafeEqual throws on length mismatch — length-check first.
  if (
    expected.length === 0 ||
    authBuf.length !== expectedBuf.length ||
    !timingSafeEqual(authBuf, expectedBuf)
  ) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // -- 4. Run the poller --------------------------------------------------
  const result = await pollGmail();
  return Response.json(result);
}
