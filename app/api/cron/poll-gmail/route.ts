// GET /api/cron/poll-gmail — Vercel Cron trigger for v0.9 reply polling.
//
// v1.1.1 BIG CHANGE: the cron secret is now DERIVED via
// getInstanceSecret("cron"), not read from a user-managed CRON_SECRET
// env var. That means we MUST bootstrap the schema + salt BEFORE we
// can verify the request's Authorization header. The order below is
// deliberately:
//
//   1. ensureSchema()  — creates instance_secrets if it's missing
//   2. getInstanceSecret("cron") — derives the bearer token; this also
//      bootstraps the salt on its first call (race-safe insert + re-read)
//   3. Verify Authorization: Bearer ${secret}
//   4. Run the poller
//
// If step 1 or 2 fails: return 503 (the deploy is broken, not the
// caller). If step 3 fails: 401 (Vercel-Cron sent the wrong header).
// Never 401 on infra failure — telegraphs misconfig to anyone who can
// trigger the route, and conflates "cron isn't wired" with "rogue
// caller".
//
// Degraded-state matrix:
//   | State                                  | Behavior                       |
//   |----------------------------------------|--------------------------------|
//   | ensureSchema fails                     | 503 schema_unavailable         |
//   | getInstanceSecret("cron") throws       | 503 secret_unavailable         |
//   | Authorization header missing/wrong     | 401 unauthorized               |
//   | All checks pass → Supabase missing     | 200, {0,0,0}                   |
//   | All checks pass → Gmail not connected  | 200, {0,0,1}                   |
//   | All checks pass → first poll           | 200, {0,0,0} (cursor seeded)   |
//   | All checks pass → cursor poll          | 200, {N,S,E} per poll          |
//
// Logging policy: route logs ONLY operational counts. NEVER reply bodies.

import { pollGmail } from "@/lib/reply/poll";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getInstanceSecret } from "@/lib/secrets/derive";

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

  // -- 2. Derive cron secret (bootstraps salt on first call) --------------
  // getInstanceSecret falls back to process.env.CRON_SECRET when
  // SUPABASE_SERVICE_ROLE_KEY is absent — that preserves the v0.x flow
  // for users who haven't redeployed against a Supabase Marketplace
  // integration yet.
  let secret: string;
  try {
    secret = await getInstanceSecret("cron");
  } catch (err) {
    console.warn(
      "[cron/poll-gmail] secret derive failed:",
      err instanceof Error ? err.message : String(err),
    );
    return new Response(JSON.stringify({ error: "secret_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // -- 3. Verify Authorization header -------------------------------------
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // -- 4. Run the poller --------------------------------------------------
  const result = await pollGmail();
  return Response.json(result);
}
