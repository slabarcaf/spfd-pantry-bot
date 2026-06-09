# =============================================================================
# config.ps1 — Non-secret settings for the SPFD pantry auto-registration bot.
# Safe to commit. Secrets live in config.local.ps1 (gitignored).
# =============================================================================

# --- What gets submitted to the form every week ---
$FirstName     = "Santiago"
$LastName      = "Labarca"
$BerkeleyEmail = "santiago.labarca@berkeley.edu"
$FamilySize    = "2"

# Which pantry day to register for. The form's option label changes weekly
# (e.g. "Sunday 6/14"), so we match the option whose label STARTS WITH this word.
# Valid values: "Sunday", "Saturday", or "Both" (Both matches exactly).
$DayPreference = "Sunday"

# --- Hard stop: on/after this date the bot stops submitting and removes its
# scheduled task. Format: yyyy-MM-dd ---
$StopDate = "2027-06-30"

# --- How the bot finds the weekly email (Gmail search query) ---
$GmailQuery = 'from:sparrfood@gmail.com subject:"SPFD waitlist Google form" newer_than:5d'

# --- Name of the Windows scheduled task (used by Install-Task.ps1 + self-delete) ---
$TaskName = "SPFD Pantry Auto-Register"
