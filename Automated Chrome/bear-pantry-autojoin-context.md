# Bear Pantry Auto-Join: Context for Claude Code

## Goal

Build a small tool that runs in the user's own Chrome, waits on the Bear Pantry Waitwhile page, and the moment the waitlist opens: clicks "Join waitlist", fills their details, and clicks "Join the line". One submission, as fast as possible, no manual clicks.

## Recommendation (build this)

A Manifest V3 Chrome extension with a content script, running in their normal, logged-in Chrome profile.

Why not Playwright/Puppeteer: the page loads Google reCAPTCHA v3 (invisible scoring). A real user profile scores better than an automation-launched browser. An extension in the everyday profile is also the simplest to deploy "here or in Chrome".

Hard rule: do not try to defeat or spoof reCAPTCHA. If a visible challenge or an error appears, stop and alert the user (sound + notification) so they finish manually.

## What I verified on the live page (Mon Oct 5, 2026)

### URLs

| Step | URL |
|---|---|
| Landing | `https://waitwhile.com/locations/bearpantry` |
| Form (after clicking Join waitlist) | `https://waitwhile.com/locations/bearpantry/details?registration=waitlist` |
| Location display name | "[UVA Residents] Bear Pantry", Albany CA 94706 |

The Next.js route list also includes `closed`, `waitlist`, `visits`, `checkin`. The closed-state URL and confirmation URL were not observable today (the list was already open). Verify on first live run.

### Landing page

- One interactive element: `<button type="button">Join waitlist</button>` (purple). Shows "People waiting: N" above it.
- No stable `data-testid`; class names are hashed styled-components (`Button-styles__StyledButton-sc-...`). Select by button text, not class.
- The page holds a live Firestore listener (`firestore.googleapis.com/.../Listen/channel`). Status changes are pushed to the page without refresh. So the button should appear on its own when staff open the list; a refresh loop is a fallback, not the primary mechanism.

### Open/closed signal (useful for polling)

The server-rendered HTML of the landing page embeds location state. Fields found:

```
"isWaitlistOpen": true,
"isOpen": true,
"numWaiting": 2,
"nextTicket": 783,
"timezone": "America/Los_Angeles",
"maxWaitingCustomerVisits": 1,      // one active entry per person
"maxWaiting": null, "maxWaitingActive": false,
"recaptchaMinScore": null
```

Configured hours (PT), as listed on Waitwhile. **Actual go-live times confirmed by the user: Mon 11:30, Tue 15:30, Thu 12:30.** The extension's watch windows use those.

| Day | Hours |
|---|---|
| Mon | 12:00 to 14:00 |
| Tue | 16:00 to 18:00 |
| Thu | 13:00 to 16:00 |
| Wed, Fri, Sat, Sun | closed |

So what: the user observes the button at 12:30 on Mondays, but configured hours start at 12:00. The list is likely opened manually by staff (toggling `isWaitlistOpen`), so the trigger must be the state change, not the clock. Use the clock only to decide when to start watching aggressively.

### Form page

| Field | Selector | Notes |
|---|---|---|
| Name (required) | `input#form_name` (`name="form_name"`, `autocomplete="name"`) | Your full name (set in Settings) |
| Phone country | `select[name="form_phoneCountry"]` | Defaults to US |
| Phone (optional) | `input#form_phone` (`type="tel"`) | e.g. (555) 555-0100, set in Settings |
| Email (optional) | `input#form_email` (`type="email"`) | e.g. you@example.com, set in Settings |
| reCAPTCHA token | `textarea[name="g-recaptcha-response"]` | Filled by Google's script. Do not touch. |
| Submit | `button` with text "Join the line" | Second `type="submit"` button; the first is "Back" |

Consent text under the button: proceeding accepts Waitwhile's Guest Terms and Privacy Policy. The user accepted this when building the tool; note it in the README.

Server error strings present in the bundle: `max_waiting_capacity_exceeded` ("The waitlist is full, please try again later."), `no_available_slots`.

## Required behavior

1. Config (extension options page, stored in `chrome.storage.local`): name, phone, email, `armed` (bool), `autoSubmit` (bool, default true), watch windows (default Mon 12:00 to 14:00, Tue 16:00 to 18:00, Thu 13:00 to 16:00 PT, start watching 10 min before).
2. Content script on `https://waitwhile.com/locations/bearpantry*`, `run_at: document_start`.
3. Landing page logic:
   - `MutationObserver` on `document.body` looking for a `button` whose trimmed `innerText` is "Join waitlist". Click immediately when found and `armed`.
   - Fallback: if the page is in a closed state, poll `fetch('/locations/bearpantry')` and regex `"isWaitlistOpen":true` (handle escaped quotes `\"`). Inside the watch window poll every 2 to 3 s; outside it, do nothing. On true, `location.href = '/locations/bearpantry/details?registration=waitlist'` (faster than waiting for the click path; confirm this deep link works when freshly opened, else fall back to reload + click).
4. Form page logic:
   - Wait for `#form_name`. Inputs are React-controlled, so set values with the native setter and dispatch events, otherwise React ignores them:
     ```js
     const set = (el, v) => {
       const proto = Object.getPrototypeOf(el);
       Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));
     };
     ```
   - Fill name, phone, email. Leave country as US.
   - Click "Join the line" if `autoSubmit`. Let reCAPTCHA v3 run normally.
5. Exactly one submission. Set a `submittedAt` flag in `chrome.storage.local` before clicking; never click again for 3 hours. `maxWaitingCustomerVisits: 1` means duplicates fail anyway, and spamming hurts other students.
6. After submit: detect success (URL change to a visit/confirmation page, or confirmation text) vs. error (`waitlist is full`, validation message, visible reCAPTCHA). Fire `chrome.notifications` + a sound either way, and log timestamps (button seen, click, form filled, submitted) to the console and storage.
7. Popup UI: armed toggle, last run log, "test mode" that fills the form but does not submit.

## Speed notes

- Keep the tab open on the landing page before the window. The Firestore push is the fastest signal; it beats any polling.
- Avoid `setTimeout` delays between steps. React hydration is the main wait: retry the form fill on `requestAnimationFrame` until inputs exist.
- Chrome throttles timers in background tabs. Keep the tab in the foreground (or a pinned, visible window), and the laptop awake and on power.
- Don't poll faster than every 2 s; it adds load without making the result faster given the live listener.

## Open questions to resolve on first live run

1. What the landing page shows when closed (no button? "closed" route? redirect?).
2. Whether `/details?registration=waitlist` loads the form directly right after opening.
3. Confirmation page URL/text after submit, and whether there are extra steps (party size, questions).
4. Whether a visible reCAPTCHA ever appears.

Recommended approach: ship test mode first, run it at the next opening (Tue 16:00 PT or Thu 13:00 PT) watching DevTools, record answers to the above, then flip `autoSubmit` on.

## Deliverables for Claude Code

- `manifest.json` (MV3; permissions: `storage`, `notifications`; host permissions `https://waitwhile.com/*`)
- `content.js` (landing + form logic, state machine keyed on `location.pathname`)
- `background.js` (notifications)
- `options.html/js`, `popup.html/js`
- `README.md`: load unpacked via `chrome://extensions`, configure, arm, test mode
