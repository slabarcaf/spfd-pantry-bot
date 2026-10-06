# Bear Pantry Auto-Join (Chrome extension)

Watches the Bear Pantry Waitwhile page in your normal Chrome. The moment the waitlist opens, it
clicks **Join waitlist**, fills your name, phone and email, and clicks **Join the line**. It
submits once, then alerts you with a notification and a sound, whether it worked or not.

It never touches reCAPTCHA. If a visible challenge or an error shows up, it stops and alerts
you so you can finish by hand.

> **Consent:** joining the line means accepting Waitwhile's Guest Terms and Privacy Policy
> (the text under the "Join the line" button). You accept those when you arm this extension.

## Install (2 minutes, one time)

1. Open `chrome://extensions` in your everyday Chrome profile.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder next to this README.
4. Pin the extension (puzzle icon → pin) so the badge is visible.
5. Click the icon → **Settings** and enter your name (required). Phone and email are
   optional. Click **Save**. Nothing runs until a name is set, and the badge shows `!` if
   you arm it without one.
6. Arm it from the popup. It stays armed across restarts, so you only do this once.

After editing any file in `extension/`, click the ↻ reload icon on the extension card, then
reload the pantry tab.

## What has to be on

The extension runs **inside Chrome on your Mac**. Nothing runs in the cloud, and Claude isn't
involved at runtime. If the Mac is off or asleep, or Chrome is quit, it won't join.

At each watch window you need:

| Requirement | Why |
|---|---|
| Mac on, **lid open, plugged in** | A closed lid sleeps the Mac. While watching, the extension keeps the display awake. |
| **Chrome running**, any window or none | On a Mac, Chrome keeps running with all windows closed. Quitting it (⌘Q) stops the extension. |
| Online | Wired or strong Wi-Fi helps a little. |

You **don't** need to open the page yourself. When a watch window starts (10 min early), the
extension opens the pantry page in its own window if no tab has it. It does this once per day,
so if you close that window on purpose it stays closed. Leave the window in front: Chrome slows
down background tabs.

**For unattended weeks:** open System Settings → Battery → Options and turn on **Prevent
automatic sleeping on power adapter when the display is off**. Add Chrome to System Settings →
General → Login Items too, so it's running after a restart. Then a plugged-in Mac with the lid
open stays ready all week without you touching it.

The badge shows the state at a glance:

| Badge | Meaning |
|---|---|
| (none) | Disarmed. The extension does nothing. |
| `!` | Armed, but no name is set in Settings. |
| `ON` | Armed, outside a watch window, so idle. |
| `LIVE` | Armed and in a watch window. It will join the moment the list opens. |
| `DONE` | Already submitted. Locked for 3 hours. |

Default watch windows (Pacific time, watching starts 10 minutes early):

| Window | Runs |
|---|---|
| `Mon 11:30-14:00` | Every Monday. This is the normal schedule. |
| `2026-10-06 15:30-18:00` | Once, Tue Oct 6, 2026, as a trial run. It never repeats. |

Tuesdays and Thursdays are off. To add another one-off date, add a line in Settings such as
`2026-10-20 15:30-18:00`. A line like `Tue 15:30-18:00` runs every week.

## How it decides to join

1. **Live push (fastest).** Waitwhile pushes status changes to the open page. When the
   **Join waitlist** button appears, the extension waits until the page is interactive
   (React hydrated, usually under 1 s) and clicks it.
2. **Fallback poll.** If there's no button, it re-checks the page's `isWaitlistOpen` flag every
   2.5 s, and only during a watch window. When the flag turns true, it jumps straight to the
   form (`/details?registration=waitlist`).
3. **Form.** It fills the fields, checks the values stuck, records the submit time, and clicks
   **Join the line** once.
4. **Result.** If the page moves to a visit/confirmation page or shows "you're in line", you get
   a success alert. A "waitlist is full" message, a validation error, a visible reCAPTCHA, or 20 s
   with no answer all produce an error alert.

Safety rails:
- **One submission.** Nothing else is submitted for 3 hours after a submit. The background
  worker hands out the lock, so even two open pantry tabs can't both submit.
  The popup's **Reset 3 h lock** button clears it.
- **Only in windows.** By default nothing happens outside the watch windows, so browsing the
  page on a Wednesday won't join. You can turn this off in Settings.
- **Already joined by hand?** Disarm the extension. It only knows about its own submissions,
  and Waitwhile allows one active entry per person anyway.

## Test mode (do this first)

- **Test fill now** (popup): opens the form in a new tab, fills it, and **never submits**. Use it
  whenever the list is open to confirm the fields still match.
- **Test mode** toggle (popup): runs the whole flow (watch → click Join waitlist → fill) but
  stops before **Join the line**. Use it for one real opening, then turn it off.

Every step is timestamped in the popup's **Log** and in DevTools (filter the console by
`[BearPantry]`).

## First live run checklist

Run one opening (Tue 15:30 or Thu 12:30) in **test mode** with DevTools open on the pantry tab,
and note:

- [ ] What the landing page shows while **closed**: no button, a `/closed` URL, or a redirect?
      The extension handles `/locations/bearpantry`, `/closed` and `/waitlist`.
- [ ] Whether the button appeared on its own when staff opened the list (log: `button_seen`) or
      the poll caught it first (log: `open_detected_by_poll`).
- [ ] Then turn test mode off. On the first real submit, note the confirmation URL/text in the
      log (`result_success · …`).

Already confirmed on Mon Oct 5, 2026 while the list was open:
- `isWaitlistOpen` is in the page HTML.
- The `/details?registration=waitlist` deep link renders the form directly.
- No sign-in, and no fields beyond name, phone and email. Only **name** is required. To submit
  name only, clear phone and email in Settings.
- The site is English only. Button matching uses the English labels "Join waitlist" and "Join the line".

## Files

| Path | Purpose |
|---|---|
| `extension/manifest.json` | MV3 manifest. Runs only on `waitwhile.com/locations/bearpantry*`. |
| `extension/content.js` | State machine: landing → form → result. |
| `extension/page-hook.js` | Tiny main-world helper that reports when React has hydrated an element. |
| `extension/background.js` | Notifications, sound, badge, keep-awake. |
| `extension/offscreen.*` | Plays the alert tones. |
| `extension/popup.*`, `extension/options.*` | UI. |
| `extension/defaults.js` | Default settings + shared helpers. |

Permissions: `storage` (settings and log), `notifications`, `offscreen` (sound), `alarms`
(badge refresh), `power` (keep the display awake during windows), and access to `waitwhile.com`
only.
