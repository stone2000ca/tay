// GET /api/cron/poll-gmail — Vercel Cron trigger for v0.9 reply polling.
//
// Vercel automatically calls cron URLs with an `Authorization: Bearer
// $CRON_SECRET` header (we register the cron in vercel.json with the
// schedule `*/5 * * * *`). We verify the header before invoking the
// poller — without this, anyone could trigger the poll.
//
// Degraded-state matrix (returns honest counts in EVERY mode):
//   | State                                  | Behavior                       |
//   |----------------------------------------|--------------------------------|
//   | CRON_SECRET missing AND no header      | 401                            |
//   | CRON_SECRET missing AND header set     | 401 (refuse to no-op-auth)     |
//   | CRON_SECRET set; header mismatch       | 401                            |
//   | CRON_SECRET set; header match → Supabase missing | 200, {0,0,0}        |
//   | CRON_SECRET set; header match → Gmail not connected | 200, {0,0,1}    |
//   | CRON_SECRET set; header match → first poll | 200, {0,0,0} (cursor seeded)|
//   | CRON_SECRET set; header match → cursor poll | 200, {N,S,E} per poll    |
//
// Logging policy: route logs ONLY operational counts. NEVER reply bodies.

import { pollGmail } from "@/lib/reply/poll";
import { ensureSchema } from "@/lib/supabase/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Auth — Vercel Cron sets Authorization: Bearer ${CRON_SECRET}.
  // We REQUIRE the secret to be set; an unconfigured deployment that
  // accepts unauthenticated cron hits would be a quiet security hole.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron/poll-gmail] CRON_SECRET missing — refusing to run");
    return new Response(JSON.stringify({ error: "cron_secret_missing" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Migrations may not have run yet on a fresh deploy — keep this
  // chokepoint guard active. ensureSchema is a no-op when Supabase
  // env is missing (skipped:true), so this is safe in all modes.
  await ensureSchema();

  const result = await pollGmail();
  return Response.json(result);
}
