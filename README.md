# SPFD Pantry — Auto-Registration Bot

Automatically registers Santiago for the weekly **Student Parent Food Donations Program**
(SPFD) pantry waitlist. Every Sun/Mon/Tue, `sparrfood@gmail.com` emails a brand-new Google
Form (the link and field ids change every week). This bot reads that email, parses the fresh
form, and submits the registration — weekly, unattended, until **2027-06-30**, when it stops
itself.

> **Also in this repo:** [`Automated Chrome/`](Automated%20Chrome/) contains a separate Chrome
> extension that auto-joins the Bear Pantry (Waitwhile) line the moment it opens.

## How it works

1. **Read Gmail** (read-only, OAuth) for the latest `"… SPFD waitlist Google form"` email and
   pull out the `forms.gle/…` link.
2. **Parse the form** — read `FB_PUBLIC_LOAD_DATA_`, map each question to its `entry.*` id by
   title keyword (robust to weekly wording/date changes), pick the **Sunday** option, and build
   a pre-filled form URL.
3. **Submit** — the form requires Google sign-in ("collect verified email"), so a plain POST is
   rejected. Instead a headless browser using a **saved Google login** opens the pre-filled form
   and clicks Submit.
4. **Idempotent** — the submitted URL is recorded in `state.json`, so extra runs never
   double-submit.

Each week Google emails you *"Thanks for filling out this form…"* — that's your confirmation.
If a run ever fails (e.g. the saved login expired), you get a **Telegram alert containing a
1-tap pre-filled link** so you can still register by hand.

## Requirements on the Casa PC

- **Node.js** (one-time install — `winget install OpenJS.NodeJS.LTS`).
- Playwright's Chromium (installed by the setup below — self-contained, no system Chrome
  needed). Optionally set `CHROME_CHANNEL=chrome` in `.env` to use installed Chrome instead.
- `gh` (already present) to pull this repo.

## One-time setup

```powershell
gh repo clone slabarcaf/spfd-pantry-bot
cd spfd-pantry-bot

npm install
npx playwright install chromium

# Secrets
Copy-Item .env.example .env
#   Fill GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (same as Melissa) and
#   GOOGLE_REFRESH_TOKEN_BERKELEY (Melissa's Berkeley token likely already works;
#   if Gmail calls 403, run:  npm run get-token  and paste the printed token).

# Sign into Google ONCE (opens a visible browser) so the bot can submit later
npm run login

# Dry run — finds the email + parses the form, prints the plan, does NOT submit
npm run dry-run

# One real run to confirm end-to-end (watch for the Google receipt email)
npm start

# Schedule it: Tuesday 9am + Thursday 9am safety net
powershell -ExecutionPolicy Bypass -File scripts\Install-Task.ps1
```

Done — it now runs itself weekly and shuts down after `stopDate`.

> **OAuth longevity:** so the Gmail refresh token survives 13 months, the Google OAuth
> client's consent screen must be **Internal** (Berkeley Workspace) or **Published** — not
> "Testing" (Testing tokens die in ~7 days). It's the same client that keeps Melissa working.
>
> **Login longevity:** the saved Google session (`.browser-profile/`) can occasionally expire.
> When it does, the bot Telegrams you the 1-tap link; re-run `npm run login` to refresh it.

## Files

| Path | Purpose |
|---|---|
| `src/index.js` | Entry point (what Task Scheduler runs). `--dry-run` to preview. |
| `src/gmail.js` | Find the weekly email, extract the form link. |
| `src/form.js` | Parse the form → entry ids + Sunday option + pre-filled URL. |
| `src/submit.js` | Headless Playwright submit using the saved login. |
| `src/login.js` | One-time: sign into Google, persist the session. |
| `src/get-token.js` | One-time (if needed): mint a `gmail.readonly` refresh token. |
| `src/auth.js` / `src/notify.js` / `src/browser.js` | OAuth, Telegram alert, browser config. |
| `config.json` | Your answers (name, email, family size, day, stop date). |
| `.env` | **Secrets** (gitignored): OAuth client + refresh token + Telegram. |
| `.browser-profile/` | Saved Google login (gitignored — contains cookies). |
| `state.json` / `spfd.log` | Idempotency log + run log (gitignored). |
| `scripts/Install-Task.ps1` | Registers the weekly scheduled task. |

## Changing your answers

Edit `config.json` — e.g. `dayPreference` to `"Both"`/`"Saturday"`, `familySize`, or move
`stopDate`. No code changes needed.
