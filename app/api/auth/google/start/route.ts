// GET /api/auth/google/start — kick off the Gmail OAuth consent flow.
//
// 1. Pre-flight: TAY_OAUTH_SECRET must exist. We refuse to start the
//    flow without it — otherwise we'd land on the callback unable to
//    encrypt the returned refresh token.
// 2. GOOGLE_OAUTH_CLIENT_ID + NEXT_PUBLIC_SITE_URL must exist too.
// 3. Generate a CSRF state token. Store it in an httpOnly cookie. The
//    callback verifies cookie matches query.
// 4. Redirect to Google's consent screen.
//
// Tay rule: never log the state token (it's a CSRF defense; logging it
// would weaken the trust model only marginally, but no benefit either).

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { buildAuthUrl } from "@/lib/oauth/google";
import { hasOAuthSecret } from "@/lib/oauth/crypto";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "tay-oauth-state";
const STATE_TTL_SECONDS = 600; // 10 minutes

export async function GET() {
  if (!(await hasOAuthSecret())) {
    redirect("/settings?error=no_oauth_secret");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  // v1.1.1: use getSiteUrl() so VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL
  // are honored as fallbacks. Empty siteUrl returns "http://localhost:3000"
  // (dev fallback), which Google rejects in production — surface a clearer
  // error than "redirect_uri_mismatch" by failing early when no URL is set.
  const siteUrl = getSiteUrl();
  if (!clientId) {
    redirect("/settings?error=no_google_client_id");
  }
  if (!siteUrl) {
    redirect("/settings?error=no_site_url");
  }

  const state = randomBytes(32).toString("hex");
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const redirectUri = `${siteUrl.replace(/\/$/, "")}/api/auth/google/callback`;
  const authUrl = buildAuthUrl({
    clientId: clientId!,
    redirectUri,
    state,
  });
  redirect(authUrl);
}
