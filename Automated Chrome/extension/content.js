// Bear Pantry Auto-Join: content script (isolated world).
//
// State machine keyed on location.pathname (Waitwhile is a Next.js SPA, so the
// route changes without reloading this script):
//   landing  /locations/bearpantry[/closed|/waitlist]
//            click "Join waitlist" as soon as it renders (pushed live by
//            Firestore); fallback: poll the page HTML for isWaitlistOpen:true.
//   form     /locations/bearpantry/details
//            fill name/phone/email once React has hydrated, click "Join the line"
//            exactly once (unless test mode).
//   result   after the click: classify success / error and alert either way.
//
// Never touches reCAPTCHA. A visible challenge = stop and alert the user.
'use strict';

const POLL_MS = 2500;
const FAST_POLL_MS = 333;            // ~3/s, from 1 min before to 1 min after go-live
const BACKOFF_MS = 2000;             // after an error or 429/5xx from the server
const RESULT_TIMEOUT_MS = 120000;    // the server can stay "busy" for a while at go-live
const HYDRATION_GRACE_MS = 3000;
const JOIN_NAV_WATCHDOG_MS = 1500;   // "Join waitlist" clicked but no form yet -> deep link
const FORM_WATCHDOG_MS = 3000;       // on /details but no form -> reload deep link
const MAX_FORM_RELOADS = 10;         // like a person hitting refresh while the server is swamped
const MAX_BUSY_RETRIES = 10;
// Opened from the popup's "Test fill now": fill only, never submit.
const TEST_TAB = location.hash === '#bp-test';

const OPEN_RE = /\\?"isWaitlistOpen\\?"\s*:\s*true/;
const SUCCESS_RE = /you(?:'|’| a)re (?:now )?(?:in line|on the (?:wait)?list)|your (?:place|position|spot) in line|added to the (?:wait)?list/i;
const ERROR_PATTERNS = [
  /waitlist is full/i, /try again later/i, /no available/i, /is required/i, /invalid/i,
  /went wrong/i, /already (?:in line|on the (?:wait)?list|waiting)/i, /not (?:currently )?open/i,
];
// Waitwhile's own retry loop when the server answers 409 at go-live. Not errors.
const BUSY_RE = /location (?:too )?busy|retrying|saving|timed out|gave up after/i;
const ROBOT_RE = /verify you(?:'|’)?re not a robot|not a robot|verify you are human/i;

let cfg = null;
let state = {};
let lastPath = null;
let joinClickedAt = 0;      // landing: last "Join waitlist" click
let buttonSeenAt = 0;       // landing: first time the button was seen
let pollTimer = null;
let pollInflight = false;
let navigating = false;
let formSeenAt = 0;         // form: first time #form_name was seen
let filledEl = null;        // form: the input we already filled
let refills = 0;            // form: re-fill attempts after values didn't stick
let testNotified = false;
let submitting = false;
let watch = null;           // result: { start, path, baseline }
let watchTimer = null;
let routeEnteredAt = Date.now();
let busyRetries = 0;
let lastRetryAt = 0;
let continueClickedAt = 0;
let robotAlertAt = 0;

// ---------- helpers ----------

function route() {
  const p = location.pathname.replace(/\/$/, '');
  if (p === BP.BASE + '/details') return 'form';
  if (p === BP.BASE || p === BP.BASE + '/closed' || p === BP.BASE + '/waitlist') return 'landing';
  return 'other';
}

function testMode() {
  return TEST_TAB || !cfg.autoSubmit;
}

function active() {
  if (!cfg.name) return false; // the only required field; set in Settings
  if (TEST_TAB) return true;
  return cfg.armed && !BP.isLocked(state) && (!cfg.onlyInWindows || BP.inWindow(cfg));
}

function findButton(text) {
  const want = text.toLowerCase();
  return [...document.querySelectorAll('button')].find((b) =>
    !b.disabled && b.offsetParent !== null && b.innerText.trim().toLowerCase() === want);
}

function findButtonMatching(re) {
  return [...document.querySelectorAll('button')].find((b) =>
    !b.disabled && b.offsetParent !== null && re.test(b.innerText.trim()));
}

function buttonLabels() {
  return [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null)
    .map((b) => b.innerText.trim() + (b.disabled ? ' (disabled)' : '')).filter(Boolean).join(' | ');
}

function headline() {
  const h = document.querySelector('h1, h2');
  return h ? h.innerText.trim().slice(0, 80) : '';
}

async function deepLink(reason) {
  if (navigating) return;
  navigating = true; // also stops landing() from clicking meanwhile
  stopPolling();
  const from = location.pathname;
  await BP.log('deep_link_nav', reason); // flush before the page unloads
  // Never reload a page that has already moved on (e.g. into the form).
  if (location.pathname !== from || watch || submitting) return;
  location.href = BP.FORM_URL;
}

function alertUser(level, title, message) {
  chrome.runtime.sendMessage({ type: 'alert', level, title, message }).catch(() => {});
}

function bodyText() {
  return document.body ? document.body.innerText : '';
}

function errorsIn(text) {
  return ERROR_PATTERNS.filter((re) => re.test(text)).map(String);
}

// React-controlled inputs ignore plain .value writes; use the native setter
// and fire the events React listens to.
function setValue(el, v) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const digits = (s) => String(s).replace(/\D/g, '');

// Filling before React hydrates gets silently lost. page-hook.js (main world)
// answers this probe by tagging the element once React owns it.
function isHydrated(el) {
  el.dispatchEvent(new CustomEvent('bp-probe', { bubbles: true }));
  return el.getAttribute('data-bp-react') === '1';
}

// Waitwhile falls back to a "Please verify you're not a robot" dialog (reCAPTCHA
// v2) when the invisible check fails. Only the user may solve it.
function robotCheckVisible() {
  const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .some((d) => d.offsetParent !== null && ROBOT_RE.test(d.innerText));
  const frame = [...document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]')].some((f) => {
    const r = f.getBoundingClientRect();
    return r.width > 100 && r.height > 100 && getComputedStyle(f).visibility !== 'hidden';
  });
  return dialog || frame;
}

// Loud, repeating alert while the robot check is up. Returns true if present.
function handleRobotCheck() {
  if (!robotCheckVisible()) { robotAlertAt = 0; return false; }
  if (!robotAlertAt) BP.log('robot_check', 'waiting for you to solve it');
  if (Date.now() - robotAlertAt > 10000) {
    robotAlertAt = Date.now();
    alertUser('error', 'Bear Pantry: solve the robot check NOW 🚨', 'Waitwhile is asking "verify you\'re not a robot". Solve it in the pantry tab; the bot continues after.');
  }
  return true;
}

// ---------- landing ----------

function landing() {
  if (navigating) return;
  if (!active()) { stopPolling(); return; }

  // Clicked "Join waitlist" but the form never came: go straight to it.
  if (joinClickedAt) {
    if (Date.now() - joinClickedAt > JOIN_NAV_WATCHDOG_MS) deepLink('join click did not navigate');
    return;
  }
  // A "Refresh"-style button: skip it and load the form directly.
  if (findButtonMatching(/^refresh|refresh$|try again/i)) { deepLink('refresh button shown'); return; }

  const btn = findButton('Join waitlist');
  if (btn) {
    stopPolling();
    if (!buttonSeenAt) { buttonSeenAt = Date.now(); BP.log('button_seen'); }
    // A server-rendered button ignores clicks until React hydrates it.
    if (!isHydrated(btn) && Date.now() - buttonSeenAt < HYDRATION_GRACE_MS) {
      requestAnimationFrame(schedule);
      return;
    }
    joinClickedAt = Date.now();
    btn.click();
    BP.log('join_clicked');
    return;
  }
  startPolling();
}

// Fast polling only in a 2-minute band around go-live (e.g. 11:29-11:31).
function pollInterval() {
  const now = BP.nowPT();
  const nearGoLive = cfg.windows.some((w) => {
    const d = now.minutes - BP.toMin(w.start);
    return BP.appliesOn(w, now) && d >= -1 && d < 1;
  });
  return nearGoLive ? FAST_POLL_MS : POLL_MS;
}

// One request in flight at most: the next starts when the previous returns and
// the interval has passed, so a slow server never gets requests piled on it.
function startPolling() {
  if (pollTimer) return;
  BP.log('polling_started', `every ${pollInterval() / 1000}s`);
  let fast = pollInterval() === FAST_POLL_MS;
  const loop = async () => {
    const started = Date.now();
    const ok = await poll();
    if (!pollTimer) return;
    const interval = pollInterval();
    if ((interval === FAST_POLL_MS) !== fast) {
      fast = !fast;
      BP.log('poll_rate', fast ? 'fast: ~3/s until 1 min after go-live' : `normal: every ${POLL_MS / 1000}s`);
    }
    const wait = ok === false ? BACKOFF_MS : Math.max(0, interval - (Date.now() - started));
    pollTimer = setTimeout(loop, wait);
  };
  pollTimer = setTimeout(loop, 0);
}

function stopPolling() {
  if (!pollTimer) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (pollInflight || navigating) return;
  if (route() !== 'landing' || !active()) { stopPolling(); return; }
  pollInflight = true;
  try {
    const res = await fetch(BP.BASE, { cache: 'no-store', credentials: 'include' });
    if (res.status === 429 || res.status >= 500) { BP.log('poll_backoff', `HTTP ${res.status}`); return false; }
    const html = await res.text();
    // The live page may have moved on (button clicked, form open) while this
    // request was in flight; never yank the user off the form.
    if (route() !== 'landing' || !active() || joinClickedAt) return;
    if (OPEN_RE.test(html)) {
      BP.log('open_detected_by_poll');
      if (findButton('Join waitlist')) { stopPolling(); schedule(); return; } // landing() clicks it
      deepLink('poll saw the list open');
    }
  } catch (e) {
    BP.log('poll_error', e.message);
    return false;
  } finally {
    pollInflight = false;
  }
}

// ---------- form ----------

function form() {
  if (!active()) return;
  const nameEl = document.querySelector('#form_name');
  if (!nameEl) {
    // On /details with no form: at go-live the server is swamped and the
    // client-side load can stall for minutes (Tue 2026-10-20: 2 min 8 s).
    // A fresh full load gets a server-rendered form, so keep reloading.
    if (Date.now() - routeEnteredAt > FORM_WATCHDOG_MS) {
      const n = +(sessionStorage.getItem('bpFormReloads') || 0);
      if (n < MAX_FORM_RELOADS) {
        sessionStorage.setItem('bpFormReloads', n + 1);
        deepLink(`no form after ${FORM_WATCHDOG_MS / 1000} s (reload ${n + 1}/${MAX_FORM_RELOADS}) · page: "${headline()}" · buttons: ${buttonLabels() || 'none'}`);
      }
    }
    return;
  }

  if (!formSeenAt) { formSeenAt = Date.now(); sessionStorage.removeItem('bpFormReloads'); BP.log('form_seen'); }
  if (!isHydrated(nameEl)) {
    if (Date.now() - formSeenAt < HYDRATION_GRACE_MS) { requestAnimationFrame(schedule); return; }
    if (filledEl !== nameEl) BP.log('hydration_probe_timeout', 'filling anyway');
  }

  const phoneEl = document.querySelector('#form_phone');
  const emailEl = document.querySelector('#form_email');

  if (filledEl !== nameEl) {
    filledEl = nameEl;
    setValue(nameEl, cfg.name);
    if (phoneEl && cfg.phone) setValue(phoneEl, cfg.phone);
    if (emailEl && cfg.email) setValue(emailEl, cfg.email);
    BP.log('form_filled');
  }

  // Verify React kept the values (a re-render can wipe them); refill if not.
  const ok = nameEl.value === cfg.name
    && (!phoneEl || !cfg.phone || digits(phoneEl.value).endsWith(digits(cfg.phone).slice(-10)))
    && (!emailEl || !cfg.email || emailEl.value === cfg.email);
  if (!ok) {
    if (refills < 5) { refills++; filledEl = null; requestAnimationFrame(schedule); return; }
    if (nameEl.value !== cfg.name) {
      if (refills++ === 5) {
        BP.log('fill_failed', 'name field would not keep its value');
        alertUser('error', 'Bear Pantry: could not fill the form ⚠️', 'Fill it in by hand in the tab.');
      }
      return;
    }
    if (refills++ === 5) BP.log('fill_partial', 'phone/email did not stick; submitting with name only');
  }

  if (testMode()) {
    if (!testNotified) {
      testNotified = true;
      BP.log('test_mode_stop', 'form filled; not submitting');
      alertUser('info', 'Bear Pantry: test fill done', 'Form filled. Test mode is on, so nothing was submitted.');
    }
    return;
  }

  if (submitting) return;
  if (findButton('Join the line')) { submit(); return; }
  // Multi-step variant: "Continue" first, then "Join the line".
  const cont = findButton('Continue');
  if (cont && Date.now() - continueClickedAt > 1500) {
    continueClickedAt = Date.now();
    cont.click();
    BP.log('continue_clicked');
  }
}

async function submit() {
  submitting = true;
  // The service worker grants the lock atomically, so two open tabs can't both submit.
  const granted = await chrome.runtime.sendMessage({ type: 'claimSubmit' }).catch(() => false);
  if (!granted) { BP.log('submit_skipped', 'locked: already submitted < 3 h ago'); return; }

  const btn = findButton('Join the line');
  if (!btn) {
    BP.log('submit_failed', '"Join the line" button vanished');
    chrome.runtime.sendMessage({ type: 'releaseSubmit' }).catch(() => {});
    submitting = false;
    return;
  }
  watch = { start: Date.now(), path: location.pathname, baseline: errorsIn(bodyText()) };
  btn.click();
  BP.log('submit_clicked');
  watchTimer = setInterval(checkResult, 300);
}

// ---------- result ----------

function checkResult() {
  if (!watch) return;
  if (location.pathname !== watch.path) return finish('success', `Navigated to ${location.pathname}`);

  const text = bodyText();
  if (SUCCESS_RE.test(text)) return finish('success', text.match(SUCCESS_RE)[0]);

  if (handleRobotCheck()) return; // keep waiting; the user solves it

  // Waitwhile gave up after its own 5 busy retries: press its retry button.
  // This resends the same rejected submission, so it's still one join.
  const retry = findButton('Click here to try again');
  if (retry && Date.now() - lastRetryAt > 1000) {
    if (busyRetries >= MAX_BUSY_RETRIES) return finish('error', `Server still busy after ${busyRetries} retries. Try by hand.`);
    busyRetries++;
    lastRetryAt = Date.now();
    retry.click();
    BP.log('busy_retry', `${busyRetries}/${MAX_BUSY_RETRIES}`);
    return;
  }
  if (BUSY_RE.test(buttonLabels())) return; // "Saving" / "Location busy, retrying in n"

  const alertText = [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText.trim())
    .filter((t) => t && !BUSY_RE.test(t)).join(' | ');
  const fresh = errorsIn(text).filter((p) => !watch.baseline.includes(p));
  if (alertText || fresh.length) return finish('error', alertText || `Page shows: ${fresh.join(', ')}`);

  if (Date.now() - watch.start > RESULT_TIMEOUT_MS) {
    return finish('unknown', 'No confirmation or error after 2 min. Check the tab.');
  }
}

function finish(outcome, detail) {
  clearInterval(watchTimer);
  watch = null;
  BP.log(`result_${outcome}`, detail);
  const titles = {
    success: 'Bear Pantry: you joined the line ✅',
    error: 'Bear Pantry: submission problem ⚠️',
    unknown: 'Bear Pantry: result unclear ⚠️',
  };
  alertUser(outcome === 'success' ? 'success' : 'error', titles[outcome], detail);
}

// ---------- loop ----------

function tick() {
  if (!cfg) return;
  // Orphaned after an extension reload: settings are unreachable, so stop.
  // The background worker reloads this tab when the next window starts.
  if (!chrome.runtime?.id) { orphaned(); return; }
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    navigating = false;
    joinClickedAt = 0;
    buttonSeenAt = 0;
    formSeenAt = 0;
    refills = 0;
    routeEnteredAt = Date.now();
    if (cfg.armed || TEST_TAB) setTimeout(() => BP.log('route', `${location.pathname} · "${headline()}" · buttons: ${buttonLabels() || 'none'}`), 800);
  }
  if (watch) { checkResult(); return; }
  if (active() && handleRobotCheck()) return;

  const r = route();
  if (r !== 'landing') stopPolling();
  if (r === 'landing') landing();
  else if (r === 'form') form();
}

let orphanWarned = false;
function orphaned() {
  stopPolling();
  if (!orphanWarned) {
    orphanWarned = true;
    console.warn('[BearPantry] Extension was reloaded; reload this tab to re-arm it.');
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  // rAF pauses in background tabs; the microtask keeps us moving there.
  queueMicrotask(() => { scheduled = false; tick(); });
}

(async () => {
  [cfg, state] = await Promise.all([BP.getConfig(), BP.getState()]);
  if (TEST_TAB) BP.log('test_tab_opened');
  if (cfg.armed) BP.log('loaded', `v${chrome.runtime.getManifest().version} on ${location.pathname}`);

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // Backstop for state that changes without DOM mutations (clock crossing a window).
  setInterval(schedule, 1000);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.config) cfg = await BP.getConfig();
    if (changes.state) state = changes.state.newValue || {};
    schedule();
  });

  schedule();
})();
