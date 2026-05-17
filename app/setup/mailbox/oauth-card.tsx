// Power-mode (Google OAuth) card. Server-component-friendly (no client
// hooks); rendered alongside the Easy column on /setup/mailbox.
//
// The button just links to the existing /api/auth/google/start route
// (lib/oauth/google) — no behavior change from v0.7. Once the OAuth
// dance completes, the callback writes to google_oauth via the existing
// path; the v1.1.2 mailbox-persist module's backwards-compat fallback
// will surface it as { kind: "oauth", ... }.
//
// (A future v1.2 cleanup could rewrite the OAuth callback to write
// directly into mailbox_credentials — out of scope for v1.1.2.)

export function OAuthCard() {
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-700 space-y-2">
        <p>
          <strong>Takes ~20 minutes.</strong> Required if:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
          <li>You&rsquo;re on Google Workspace (some orgs disable App Passwords)</li>
          <li>Your Google account uses passkey-only sign-in (no App Password option)</li>
          <li>You want IMAP-free reply polling via Gmail&rsquo;s push API</li>
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-2">
        <p className="font-medium text-gray-700">First time?</p>
        <p>
          You&rsquo;ll need a Google Cloud OAuth client. Set one up at{" "}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-800"
          >
            console.cloud.google.com/apis/credentials
          </a>
          , then set <code>GOOGLE_OAUTH_CLIENT_ID</code> +{" "}
          <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in your Vercel env.
        </p>
      </div>

      <a
        href="/api/auth/google/start"
        className="block w-full text-center rounded-lg border border-gray-900 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
      >
        Connect Gmail (OAuth)
      </a>
    </div>
  );
}
