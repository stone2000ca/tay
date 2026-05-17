// Raw-fetch Google OAuth 2.0 client — Tay v0.7.
//
// We DELIBERATELY do not pull in google-auth-library — it ships ~1MB of
// JS that Tay would never use, and we only need three HTTP calls
// (authorize URL, code exchange, refresh). Raw fetch is fewer deps,
// fewer transitive vulnerabilities, and trivially auditable.
//
// Tay rule: NEVER log raw tokens or OAuth codes. Error paths log HTTP
// status + a generic message — NEVER the response body, NEVER the code,
// NEVER the access_token / refresh_token.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Scope: send-only. Read scope lands in v0.9 for reply handling. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: GMAIL_SEND_SCOPE,
    // access_type=offline + prompt=consent guarantees Google returns a
    // refresh_token on first consent AND on re-consent (Google only emits
    // refresh_token on the first consent unless prompt=consent forces it).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: args.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

/**
 * Exchange an authorization code for tokens. Throws on non-200 or
 * when the response shape is missing a refresh_token (which would
 * mean the user revoked + reconsented without prompt=consent —
 * but we always send prompt=consent, so this should never happen).
 *
 * NEVER log the raw response body — it contains the tokens.
 */
export async function exchangeCodeForTokens(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    // Log HTTP status only — body may contain the code or partial token.
    console.warn(`[oauth/google] code exchange failed: HTTP ${res.status}`);
    throw new Error(`Google token exchange failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const accessToken =
    typeof json.access_token === "string" ? json.access_token : "";
  const refreshToken =
    typeof json.refresh_token === "string" ? json.refresh_token : "";
  const expiresIn =
    typeof json.expires_in === "number" ? json.expires_in : 0;
  const scope = typeof json.scope === "string" ? json.scope : "";
  if (!accessToken || !refreshToken || !expiresIn) {
    // Don't include the raw response shape in the error — could leak.
    console.warn("[oauth/google] code exchange returned incomplete tokens");
    throw new Error(
      "Google token exchange returned an unexpected shape (missing access_token / refresh_token / expires_in).",
    );
  }
  return { accessToken, refreshToken, expiresIn, scope };
}

export type RefreshResult = {
  accessToken: string;
  expiresIn: number;
};

/**
 * Refresh an access token using the stored refresh_token. Google does
 * NOT return a new refresh_token on refresh, so callers re-use the one
 * they already have.
 */
export async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<RefreshResult> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    console.warn(`[oauth/google] refresh failed: HTTP ${res.status}`);
    throw new Error(`Google token refresh failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const accessToken =
    typeof json.access_token === "string" ? json.access_token : "";
  const expiresIn =
    typeof json.expires_in === "number" ? json.expires_in : 0;
  if (!accessToken || !expiresIn) {
    console.warn("[oauth/google] refresh returned incomplete response");
    throw new Error(
      "Google token refresh returned an unexpected shape (missing access_token / expires_in).",
    );
  }
  return { accessToken, expiresIn };
}

/**
 * Fetch the connected account's email via userinfo. Only field we use:
 * `email`. v0.7 stores this in google_oauth.email_address so the user
 * can see "Gmail connected: jane@example.com" on /settings.
 */
export async function getProfileEmail(args: {
  accessToken: string;
}): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    console.warn(`[oauth/google] userinfo failed: HTTP ${res.status}`);
    throw new Error(`Google userinfo failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const email = typeof json.email === "string" ? json.email : "";
  if (!email) {
    throw new Error("Google userinfo returned no email field.");
  }
  return email;
}
