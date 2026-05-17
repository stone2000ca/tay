// Raw-fetch Google OAuth 2.0 client — Tay v0.7 (scope extended in v0.9).
//
// We DELIBERATELY do not pull in google-auth-library — it ships ~1MB of
// JS that Tay would never use, and we only need a handful of HTTP calls
// (authorize URL, code exchange, refresh, userinfo, messages.list,
// messages.get, history.list, getProfile). Raw fetch is fewer deps,
// fewer transitive vulnerabilities, and trivially auditable.
//
// Tay rule: NEVER log raw tokens or OAuth codes. Error paths log HTTP
// status + a generic message — NEVER the response body, NEVER the code,
// NEVER the access_token / refresh_token, NEVER reply bodies.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Send-only scope (v0.7). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Read scope (v0.9) — needed for reply ingestion via polling. */
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Full Tay scope set requested at OAuth time. Users connected pre-v0.9
 * only carry `gmail.send`; the /settings page detects that via
 * `hasReadScope` and surfaces a "Reconnect Gmail for reply handling"
 * banner. Re-consenting writes the new scope string into google_oauth.
 */
export const TAY_GMAIL_SCOPES = `${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE}`;

/** True iff the stored scope string includes the readonly grant. */
export function hasReadScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  // Google returns space-separated scopes. Substring is sufficient because
  // the URL is unique and not a substring of any other Gmail scope.
  return scope.includes(GMAIL_READONLY_SCOPE);
}

export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: TAY_GMAIL_SCOPES,
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

// ---------------------------------------------------------------------
// v0.9 — Gmail read endpoints used by the reply poller.
// ---------------------------------------------------------------------

export type GmailProfile = {
  emailAddress: string;
  /**
   * Current Gmail `historyId` for the account. Used to seed
   * `gmail_poll_cursor` on first poll (no backfill — see lib/reply/poll.ts).
   */
  historyId: string;
};

/**
 * users.getProfile — returns the account email + the current `historyId`.
 * Throws on non-200 or missing fields. Logs HTTP status only.
 */
export async function getProfile(args: {
  accessToken: string;
}): Promise<GmailProfile> {
  const res = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    console.warn(`[oauth/google] getProfile failed: HTTP ${res.status}`);
    throw new Error(`Gmail getProfile failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const emailAddress =
    typeof json.emailAddress === "string" ? json.emailAddress : "";
  // historyId is a uint64 in Google's schema — they sometimes ship it
  // as a number, sometimes as a string. Normalize to string.
  const historyIdRaw = json.historyId;
  const historyId =
    typeof historyIdRaw === "string"
      ? historyIdRaw
      : typeof historyIdRaw === "number"
        ? String(historyIdRaw)
        : "";
  if (!emailAddress || !historyId) {
    throw new Error("Gmail getProfile returned an unexpected shape.");
  }
  return { emailAddress, historyId };
}

export type GmailMessageRef = { id: string; threadId: string };

/**
 * List recent messages OR (when `after` is set) the messages added since
 * a known historyId. Uses the History API in the after-cursor case so we
 * only fetch DELTAS — much cheaper and avoids re-processing already-seen
 * replies. Returns an empty array on an empty result, throws on HTTP error.
 *
 * `maxResults` caps the response page; for v0.9 we don't paginate. If the
 * cursor falls more than ~1000 messages behind we'd lose data — acceptable
 * tradeoff for v0.9 (the cron runs every 5 min), revisit in v1.0.
 */
export async function getRecentMessages(args: {
  accessToken: string;
  after?: string;
  maxResults?: number;
}): Promise<GmailMessageRef[]> {
  const max = args.maxResults ?? 100;
  let url: string;
  if (args.after) {
    // History API gives us the delta since the cursor. We only care about
    // messageAdded events — that's the universe of "new replies".
    const params = new URLSearchParams({
      startHistoryId: args.after,
      historyTypes: "messageAdded",
      maxResults: String(max),
    });
    url = `${GMAIL_API_BASE}/history?${params.toString()}`;
  } else {
    const params = new URLSearchParams({ maxResults: String(max) });
    url = `${GMAIL_API_BASE}/messages?${params.toString()}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    console.warn(`[oauth/google] getRecentMessages failed: HTTP ${res.status}`);
    throw new Error(`Gmail list failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;

  const out: GmailMessageRef[] = [];
  const seen = new Set<string>();
  if (args.after) {
    const history = Array.isArray(json.history) ? json.history : [];
    for (const entry of history) {
      const added = (entry as Record<string, unknown>).messagesAdded;
      if (!Array.isArray(added)) continue;
      for (const a of added) {
        const m = (a as Record<string, unknown>).message;
        if (!m || typeof m !== "object") continue;
        const mo = m as Record<string, unknown>;
        const id = typeof mo.id === "string" ? mo.id : "";
        const threadId = typeof mo.threadId === "string" ? mo.threadId : "";
        if (id && threadId && !seen.has(id)) {
          seen.add(id);
          out.push({ id, threadId });
        }
      }
    }
  } else {
    const messages = Array.isArray(json.messages) ? json.messages : [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const mo = m as Record<string, unknown>;
      const id = typeof mo.id === "string" ? mo.id : "";
      const threadId = typeof mo.threadId === "string" ? mo.threadId : "";
      if (id && threadId && !seen.has(id)) {
        seen.add(id);
        out.push({ id, threadId });
      }
    }
  }
  return out;
}

export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** Decoded text/plain body. Empty string when no plain part is present. */
  body: string;
  /** Gmail's internalDate is ms-since-epoch; we ISO-format it. */
  internalDate: string;
};

/**
 * Fetch a single message and decode it. Format=full so the payload tree
 * is available. We extract:
 *   - from / subject headers (case-insensitive lookup)
 *   - the first text/plain body part, base64url-decoded
 *
 * If no text/plain part exists we return an empty body string rather than
 * fall back to text/html — the classifier wants plain text, and an empty
 * body classifies cleanly as "other" via the validator's reject-empty
 * check downstream.
 */
export async function getMessage(args: {
  accessToken: string;
  id: string;
}): Promise<GmailMessage> {
  const res = await fetch(
    `${GMAIL_API_BASE}/messages/${encodeURIComponent(args.id)}?format=full`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
  if (!res.ok) {
    console.warn(`[oauth/google] getMessage failed: HTTP ${res.status}`);
    throw new Error(`Gmail get message failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<string, unknown>;

  const id = typeof json.id === "string" ? json.id : args.id;
  const threadId =
    typeof json.threadId === "string" ? json.threadId : "";
  const internalDateRaw = json.internalDate;
  const internalMs =
    typeof internalDateRaw === "string"
      ? Number(internalDateRaw)
      : typeof internalDateRaw === "number"
        ? internalDateRaw
        : NaN;
  const internalDate = Number.isFinite(internalMs)
    ? new Date(internalMs).toISOString()
    : new Date().toISOString();

  const payload = json.payload as Record<string, unknown> | undefined;
  const headers = extractHeaders(payload?.headers);
  const from = headers["from"] ?? "";
  const subject = headers["subject"] ?? "";
  const body = extractPlainBody(payload);

  return { id, threadId, from, subject, body, internalDate };
}

// ---------- internal: header / body extraction ----------

function extractHeaders(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(input)) return out;
  for (const h of input) {
    if (!h || typeof h !== "object") continue;
    const ho = h as Record<string, unknown>;
    const name = typeof ho.name === "string" ? ho.name.toLowerCase() : "";
    const value = typeof ho.value === "string" ? ho.value : "";
    if (name && value && !(name in out)) {
      out[name] = value;
    }
  }
  return out;
}

function extractPlainBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const found = findPlainPart(payload as Record<string, unknown>);
  if (!found) return "";
  return decodeBase64UrlUtf8(found);
}

function findPlainPart(
  node: Record<string, unknown>,
): string | null {
  // Direct payload with body.data.
  const mimeType =
    typeof node.mimeType === "string" ? node.mimeType.toLowerCase() : "";
  const body = node.body as Record<string, unknown> | undefined;
  const data = typeof body?.data === "string" ? body.data : "";

  if (mimeType.startsWith("text/plain") && data) {
    return data;
  }

  // Multipart: recurse into parts. Prefer text/plain over text/html.
  const parts = Array.isArray(node.parts) ? node.parts : [];
  // First pass — direct text/plain.
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const got = findPlainPart(p as Record<string, unknown>);
    if (got) return got;
  }
  return null;
}

function decodeBase64UrlUtf8(s: string): string {
  try {
    const padLen = (4 - (s.length % 4)) % 4;
    const padded = s + "=".repeat(padLen);
    const std = padded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(std, "base64").toString("utf8");
  } catch {
    return "";
  }
}
