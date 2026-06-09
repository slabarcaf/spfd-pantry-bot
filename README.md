# SPFD Pantry — Auto-Registration Bot

Automatically registers Santiago for the weekly **Student Parent Food Donations Program**
(SPFD) pantry waitlist. Every Sun/Mon/Tue, `sparrfood@gmail.com` emails a brand-new Google
Form (the link and field IDs change every week). This bot reads that email, parses the
fresh form, and submits the registration — every week, unattended, until **2027-06-30**,
when it stops itself.

## How it works

1. Reads Gmail (read-only) for the latest `"… SPFD waitlist Google form"` email and pulls
   out the `forms.gle/…` link.
2. Fetches the form, parses `FB_PUBLIC_LOAD_DATA_` to find each question's `entry.*` id
   (matched by title keyword, since wording/dates change weekly), and picks the **Sunday**
   day option.
3. POSTs the response (no Google sign-in required — the form takes a plain email field).
4. Records the submitted URL in `state.json` so re-runs never double-submit.

Confirmation each week is automatic: Google emails you *"Thanks for filling out this
form…"*. Failures (if any) optionally ping you on Telegram.

## Requirements — nothing to install

Runs on **pure Windows built-ins**: PowerShell 5.1+ and Task Scheduler. No Node, no Python.
You only need `gh` (already on the Casa PC) to pull this repo.

## One-time setup on the Casa PC

```powershell
# 1. Get the code
gh repo clone <your-username>/spfd-pantry-bot
cd spfd-pantry-bot

# 2. Create your secrets file
Copy-Item config.local.ps1.example config.local.ps1
#    Edit config.local.ps1: paste $GoogleClientId + $GoogleClientSecret
#    (reuse the SAME values as the Melissa project).

# 3. Mint a Gmail-read refresh token (opens a browser; sign in as your Berkeley account)
.\Get-RefreshToken.ps1
#    Copy the printed token into config.local.ps1 as $GoogleRefreshToken.

# 4. Dry run — proves it finds the email + parses the form, WITHOUT submitting
.\Register-Spfd.ps1 -DryRun

# 5. One real submission to confirm end-to-end (check for the Google receipt email)
.\Register-Spfd.ps1

# 6. Schedule it: Tuesday 9am + Thursday 9am safety net
.\Install-Task.ps1
```

That's it. It now runs itself every week and shuts down after `StopDate`.

> **OAuth longevity:** so the refresh token survives 13 months, the Google OAuth client's
> consent screen must be **Internal** (Berkeley Workspace) or **Published** — not "Testing"
> (Testing tokens expire in ~7 days). This is the same client that keeps Melissa working,
> so it's already set correctly.

## Files

| File | Purpose |
|---|---|
| `Register-Spfd.ps1` | Entry point (what Task Scheduler runs). `-DryRun` to preview. |
| `Spfd-Lib.ps1` | OAuth, Gmail search, form parse, submit, logging. |
| `config.ps1` | Non-secret answers (name, email, family size, day, stop date). |
| `config.local.ps1` | **Secrets** (gitignored): OAuth client + refresh token. |
| `Get-RefreshToken.ps1` | One-time helper to mint the Gmail refresh token. |
| `Install-Task.ps1` | Registers the weekly scheduled task. |
| `state.json` | Submitted-URL log for idempotency (gitignored, auto-created). |
| `spfd.log` | Run log (gitignored, auto-created). |

## Changing your answers

Edit `config.ps1` — e.g. change `$DayPreference` to `"Both"` or `"Saturday"`, update
`$FamilySize`, or move `$StopDate`. No code changes needed.
