// GET /api/auth/google/callback — receive Google's consent redirect.
//
// 1. Validate CSRF: state cookie must equal the `state` query param.
// 2. Exchange `code` for tokens via Google's token endpoint.
// 3. Fetch the connected account's email via userinfo.
// 4. Encrypt + persist (saveGoogleOAuth handles encryption internally).
// 5. Append audit row (action=oauth.connected).
// 6. Clear the state cookie.
// 7. Redirect to /settings with success or error query param.
//
// Tay rule: NEVER log the OAuth code or the returned tokens. Failure
// paths log a generic message + HTTP status only.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureSchema } from "@/lib/supabase/migrate";
import { exchangeCodeForTokens, getProfileEmail } from "@/lib/oauth/google";
import { saveGoogleOAuth } from "@/lib/oauth/persist";
import { appendAudit } from "@/lib/audit/append";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "tay-oauth-state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Always clear the state cookie — it's single-use.
  const store = await cookies();
  const stateCookie = store.get(STATE_COOKIE)?.value;
  store.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  if (errorParam) {
    // Google sent us back with an error (user denied consent, etc.).
    // Log the error param (it's enum-shaped, not sensitive) but NEVER
    // the code (it won't be present anyway in error paths).
    console.warn(`[oauth] consent declined: ${errorParam}`);
    redirect("/settings?error=consent_declined");
  }

  if (!code || !stateParam) {
    redirect("/settings?error=missing_code");
  }
  if (!stateCookie || stateCookie !== stateParam) {
    console.warn("[oauth] CSRF state mismatch");
    redirect("/settings?error=state_mismatch");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    console.warn("[oauth] callback missing env vars");
    redirect("/settings?error=server_misconfigured");
  }

  const redirectUri = `${siteUrl!.replace(/\/$/, "")}/api/auth/google/callback`;

  await ensureSchema();

  try {
    const tokens = await exchangeCodeForTokens({
      clientId: clientId!,
      clientSecret: clientSecret!,
      code: code!,
      redirectUri,
    });
    const email = await getProfileEmail({ accessToken: tokens.accessToken });
    await saveGoogleOAuth({
      emailAddress: email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });
    await appendAudit({
      action: "oauth.connected",
      payload: {
        provider: "google",
        // email_address is the SENDER's own email. The audit redactor
        // matches "email" → "[redacted]" — fine; the audit just needs to
        // record THAT an OAuth happened, not which inbox.
        email_address: email,
      },
    });
  } catch (err) {
    // Log a generic message — the underlying message may include HTTP
    // status, which is fine, but we deliberately don't echo it to the
    // user via the redirect (avoids fingerprinting).
    console.warn(
      "[oauth] callback failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect("/settings?error=connect_failed");
  }

  redirect("/settings?connected=true");
}
