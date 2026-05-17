// GET /api/audit/verify — walk the audit hash chain and report integrity.
//
// Auth: NONE in v0.6. Single-tenant — the user's whole Vercel project
// is their property; if someone can hit this endpoint they already own
// the install. v0.7+ may layer Vercel deployment protection or an
// admin cookie if multi-user enters the picture, but v0.6 keeps it
// open-by-design so the user can curl it from anywhere.
//
// Always returns HTTP 200 — ok/not-ok is in the JSON body. This makes
// the endpoint trivially scriptable: a JSON parser is the only
// dependency a caller needs. Errors live in `result.brokenAt.reason`.

import { verifyAuditChain } from "@/lib/audit/verify";

export const runtime = "nodejs";

export async function GET() {
  const result = await verifyAuditChain();
  return Response.json(result);
}
