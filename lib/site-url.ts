// Site URL resolver — Tay v1.1.1.
//
// Replaces the v0.x pattern of "every caller reads
// process.env.NEXT_PUBLIC_SITE_URL directly" with a single helper that
// falls through Vercel's auto-set vars when no explicit URL is set:
//
//   NEXT_PUBLIC_SITE_URL                       — explicit user override
//   VERCEL_PROJECT_PRODUCTION_URL              — set on production deploys
//   VERCEL_URL                                 — set on preview deploys
//   http://localhost:3000                      — dev fallback
//
// Why this exists: pre-v1.1 the user had to manually paste their Vercel
// URL into NEXT_PUBLIC_SITE_URL after first deploy. Forgetting it broke
// the Gmail OAuth callback (redirect_uri_mismatch) and the unsubscribe
// link (relative-URL emails). VERCEL_URL is set automatically by Vercel
// on every deploy, so honoring it eliminates the manual step.
//
// Trailing-slash normalization: we strip them. Callers concat their own
// path (e.g. `${getSiteUrl()}/api/auth/google/callback`).
//
// READ-VS-WRITE: this is a pure synchronous read. No I/O. No DB. Returns
// a non-empty string ALWAYS — the dev fallback ensures every caller
// gets something useable in local dev.

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.replace(/\/+$/, "");
  }
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodUrl && prodUrl.trim().length > 0) {
    return `https://${prodUrl.replace(/\/+$/, "")}`;
  }
  const previewUrl = process.env.VERCEL_URL;
  if (previewUrl && previewUrl.trim().length > 0) {
    return `https://${previewUrl.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
}
