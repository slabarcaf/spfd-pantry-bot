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
5. Click the icon → **Settings** and check your name, phone and email. They're pre-filled
   with the values from the spec. Click **Save**.

After editing any file in `extension/`, click the ↻ reload icon on the extension card, then
reload the pantry tab.

## Before each pantry day

1. Click the icon → **Open pantry tab**. Put that tab in its own window and leave it in the
   foreground. Chrome slows down timers in background tabs.
2. Keep the Mac **plugged in with the lid open**. While watching, the extension keeps the display
   awake, but closing the lid still puts the Mac to sleep.
3. Check that **Armed** is on and the badge says `ON`. The badge switches to `LIVE` during a
   watch window and to `DONE` after it submits.

The badge shows the state at a glance:

| Badge | Meaning |
|---|---|
| (none) | Disarmed. The extension does nothing. |
| `ON` | Armed, outside a watch window, so idle. |
| `LIVE` | Armed and in a watch window. It will join the moment the list opens. |
| `DONE` | Already submitted. Locked for 3 hours. |

Default watch windows (Pacific time) start 10 minutes early: Mon 12:00–14:00, Tue
16:00–18:00, Thu 13:00–16:00. Change them in Settings.

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
- **One submission.** Nothing else is submitted for 3 hours after a submit, across all tabs.
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

Run one opening (Tue 16:00 or Thu 13:00) in **test mode** with DevTools open on the pantry tab,
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
