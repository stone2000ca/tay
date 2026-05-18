# Deploy Tay — step-by-step walkthrough

This is the literal step-by-step for installing Tay on Vercel. Should take **~10–15 minutes** end-to-end for a non-technical user using Easy mode. No terminal, no Google Cloud Console required for Easy mode.

If anything in this doc gets out of date, treat the in-app wizard at `/setup` as the source of truth — it walks the same steps.

---

## Part 1 — Before you click Deploy (3 minutes)

You'll need to have ONE of these LLM API keys ready (you'll paste it in the wizard, not Vercel):

| Provider | How to get a key | Set a spending limit |
|---|---|---|
| **Anthropic** (recommended for first install) | https://console.anthropic.com/settings/keys → "Create Key" → copy the `sk-ant-...` | https://console.anthropic.com/settings/limits — set monthly cap to $20 |
| **OpenAI** | https://platform.openai.com/api-keys → "Create new secret key" → copy the `sk-...` | https://platform.openai.com/settings/organization/billing/limits — set monthly cap |
| **OpenRouter** (one key, many models) | https://openrouter.ai/keys → "Create Key" → copy the `sk-or-...` | https://openrouter.ai/settings/credits — set credit cap |

Pick whichever you already have an account with. All three work — Tay auto-detects from the key prefix.

If you want **Easy mode** for sending (recommended for personal Gmail), do this now too:

1. Go to https://myaccount.google.com/security
2. Confirm **2-Step Verification** is ON. If not, set it up (5 min — needs your phone).
3. After 2-Step is on, visit https://myaccount.google.com/apppasswords (or search "App passwords" in your Google Account search bar — Google sometimes hides this page)
4. Create new App Password named "Tay" → copy the 16-character password somewhere safe

If 2-Step Verification can't be enabled (Workspace policy) OR your account uses passkey-only sign-in, App Passwords won't work for you. You'll use Power mode instead (see Part 6).

---

## Part 2 — Click Deploy (1 minute)

1. Click the **Deploy with Vercel** button in [README.md](./README.md).
2. Sign in to Vercel (or create a free account).
3. Pick a Vercel team/scope. For personal use, your own username is fine.
4. Project name: `tay` (or whatever you want).
5. **You will NOT be prompted for env vars** — that's intentional. The wizard collects what it needs.
6. Click **Deploy**.
7. Wait ~90 seconds for the build to finish. Vercel will show the deploy URL when done (e.g. `tay-yourname.vercel.app`).

**Don't open the URL yet** — Tay needs Supabase first.

---

## Part 3 — Connect Supabase (3 minutes)

1. In your Vercel project dashboard, click the **Storage** tab.
2. Click **Browse Marketplace** (or "Create Database" → "Marketplace").
3. Find **Supabase** and click **Add Integration**.
4. Sign in to Supabase (free account; create one if needed).
5. Pick a project name (e.g. "tay-db") and region (pick the closest to you).
6. Click **Create**.
7. Supabase provisions the database (~30 seconds). Vercel auto-writes these env vars to your project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `POSTGRES_URL`
   - `POSTGRES_URL_NON_POOLING`
8. Vercel may auto-trigger a redeploy. If not: go to your project's **Deployments** tab → click the latest deployment → click the **⋯** menu → **Redeploy**.
9. Wait for the redeploy to finish (~60 seconds).

---

## Part 4 — Open Tay and walk the wizard (5 minutes)

1. Open your Tay URL (the `tay-yourname.vercel.app` from Part 2).
2. You'll land on `/setup` — the first wizard step.

### Step 1: Name your instance
- Type a friendly name (e.g. "Acme Outbound" or "My Tay").
- Click **Continue**.

### Step 2: Paste your LLM key
- Paste the key from Part 1 (`sk-ant-...` / `sk-...` / `sk-or-...`).
- Tay auto-detects the provider and confirms.
- Click **Validate & continue**.
  - If you see "Invalid API key": double-check you copied the whole key, no extra spaces.
  - If you see "Rate limited" or "Couldn't reach the provider": wait 30 seconds and retry.

### Step 3: Connect a mailbox
You'll see two columns: **Easy** (recommended for personal Gmail) and **Power** (for Workspace / passkey-only accounts).

**Easy path (~2 minutes):**
1. Enter the email address you want to send FROM.
2. Paste the 16-character App Password from Part 1.
3. Click **Verify & save**.
4. If you get "App Password rejected" → either your password was wrong, OR your account uses passkey-only sign-in. Switch to Power mode (see Part 6).
5. On success: Tay confirms and continues to voice calibration.

### Step 4: Calibrate your voice
You'll see four options. Pick whichever fits:

| Option | When to pick | Time |
|---|---|---|
| **Paste 1+ sample emails** | You have past cold emails handy (forwarded to yourself, in Drafts, in Sent) | 3 min |
| **Answer 3 quick questions** | You can describe how you write but don't have samples nearby | 2 min |
| **Bootstrap from my company URL** | You have a polished company website that reflects your voice | 1 min |
| **I've never sent a cold email** | You're starting from scratch — Tay prompts you to write one on the spot | 5 min |

All four paths produce a voice rubric. After extraction, you'll see the rubric in plain English — tweak any field if it looks off, then click **Save and continue**.

### Step 5: Sample draft (the "aha moment")
- Tay drafts a sample email against a fake prospect (Alex Chen, VP Sales, Acme Corp) using your just-calibrated rubric.
- The judge runs and approves (or revises).
- You see the draft + judge badge + the AI disclosure footer.
- If it sounds like you: click **Continue to test-send**.
- If it doesn't sound like you: click **Recalibrate voice** and try a different option in Step 4.

### Step 6: Test-send to your own inbox
- Tay drafts an email TO YOU using your rubric.
- Click **Send**.
- Check your inbox in ~30 seconds.
- If it arrived: click **Continue**.
- If it didn't arrive: check your spam folder. If it's there, mark as "Not spam" so future sends land in inbox.
- If it's still not there: the mailbox connection failed at send time. Click **Reconnect mailbox** and verify your App Password.

### Step 7: Add your first prospect
- Type 1-2 sentences describing a real prospect ("I met Sarah at the Stripe event, she runs ops at a fintech in NYC").
- A cheap LLM extracts `full_name`, `company`, `notes`.
- Review the extracted fields, edit anything that's off, then click **Save and start drafting**.

You're now on the `/draft` page with the prospect pre-filled. Click **Generate** to draft your first real email.

---

## Part 5 — Set up notifications (optional, 2 minutes)

By default, Tay emails you when a reply comes in (uses your connected mailbox). To change:

1. Click **Settings** in the nav → **Notifications**.
2. Pick channel: **Email** (default — zero setup), **Slack webhook** (advanced — needs a webhook URL), or **None**.
3. Optionally narrow to specific intents (e.g. only "interested" replies for higher signal).
4. Click **Send test notification** to verify the channel works.
5. Save.

---

## Part 6 — Power mode (Google OAuth) if Easy mode didn't work

Only do this if Easy mode failed (Workspace account / passkey-only / App Password not generating).

This takes ~20 minutes and requires the Google Cloud Console. You'll need to:

1. Create a Google Cloud project at https://console.cloud.google.com/
2. Enable the Gmail API
3. Configure the OAuth consent screen (External, set yourself as a test user)
4. Create an OAuth Client ID:
   - Application type: **Web application**
   - Authorized redirect URI: `https://your-tay-url.vercel.app/api/auth/google/callback`
5. Copy the Client ID and Client Secret
6. In Vercel project Settings → Environment Variables, add:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
7. Redeploy
8. Back in Tay's wizard, choose **Power mode** in the Mailbox step → click **Connect Gmail** → consent in Google's screen → return to Tay

If you get stuck on consent screen verification: that's a Google Cloud Console quirk. You can add yourself as a test user under "OAuth consent screen → Test users" without going through full verification.

---

## Part 7 — After install — what now?

You have a working Tay. From here:

- **Add more prospects** at `/draft` (or directly via the form there).
- **Watch the queue** at `/queue` — drafts the judge approved are ready to send. Click Send per row.
- **Watch for replies** at `/replies` — Tay polls every 5 minutes and classifies inbound mail.
- **Audit everything** at `/audit` — every Tier-3 action (send, judge decision, suppression change) is in a tamper-evident sha256 chain. `/api/audit/verify` returns chain integrity.
- **Trust tiers** at `/settings/trust` — Tay tracks your sent/bounce/complaint rates and can promote the send capability from tier_0 (manual approval per send) to tier_1 (auto-send on judge approval) once you have a clean track record.

## Troubleshooting

### "Supabase not configured" banner everywhere
Supabase env vars not set or not yet picked up by the deploy. Go to Vercel project → Storage tab → confirm Supabase integration is connected → trigger a redeploy.

### "Configure LLM key first" on every page
You didn't finish the wizard's LLM key step. Visit `/setup/llm-key` and paste your key.

### Send button is greyed out on `/queue`
Either: (a) no mailbox connected (go to `/settings/notifications`), (b) no voice rubric (go to `/setup/voice`), (c) the draft hasn't been judged yet (refresh in 5 seconds).

### Replies aren't showing up
- For Easy mode: replies take up to 5 minutes (cron polls IMAP on that cadence)
- Check that the reply was sent to the same address you configured for sending
- For OAuth mode (Power): also check the Google Cloud OAuth scope includes `gmail.readonly`

### The wizard sent me through twice
You hit a redirect-loop because `setup_complete` didn't get set. Open `/settings` to see what's missing; the wizard re-entry point will skip steps that are already done.

### Vercel build failed
Check the deploy logs. Most common cause: a `npm install` failure (Vercel will surface the specific package). Open an issue.

---

## What you don't need

- A terminal
- `npm install` on your machine
- `openssl rand` or any other secret generation
- Vercel CLI
- Google Cloud Console (Easy mode only)
- Docker
- A database admin password
