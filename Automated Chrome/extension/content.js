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
const RESULT_TIMEOUT_MS = 20000;
const HYDRATION_GRACE_MS = 3000;
// Opened from the popup's "Test fill now": fill only, never submit.
const TEST_TAB = location.hash === '#bp-test';

const OPEN_RE = /\\?"isWaitlistOpen\\?"\s*:\s*true/;
const SUCCESS_RE = /you(?:'|’| a)re (?:now )?(?:in line|on the (?:wait)?list)|your (?:place|position|spot) in line|added to the (?:wait)?list/i;
const ERROR_PATTERNS = [
  /waitlist is full/i, /try again later/i, /no available/i, /is required/i, /invalid/i,
  /went wrong/i, /already (?:in line|on the (?:wait)?list|waiting)/i, /not (?:currently )?open/i,
  /recaptcha|verify you are human|not a robot/i,
];

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

function visibleRecaptchaChallenge() {
  return [...document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]')].some((f) => {
    const r = f.getBoundingClientRect();
    return r.width > 100 && r.height > 100 && getComputedStyle(f).visibility !== 'hidden';
  });
}

// ---------- landing ----------

function landing() {
  if (!active()) { stopPolling(); return; }

  const btn = findButton('Join waitlist');
  if (btn) {
    stopPolling();
    // Retry only if a previous click didn't navigate within 3 s.
    if (Date.now() - joinClickedAt < 3000) return;
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

function startPolling() {
  if (pollTimer) return;
  BP.log('polling_started', `every ${POLL_MS / 1000}s`);
  pollTimer = setInterval(poll, POLL_MS);
  poll();
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (pollInflight || navigating) return;
  if (route() !== 'landing' || !active()) { stopPolling(); return; }
  pollInflight = true;
  try {
    const res = await fetch(BP.BASE, { cache: 'no-store', credentials: 'include' });
    const html = await res.text();
    // The live page may have moved on (button clicked, form open) while this
    // request was in flight; never yank the user off the form.
    if (route() !== 'landing' || !active() || Date.now() - joinClickedAt < 3000) return;
    if (OPEN_RE.test(html)) {
      stopPolling();
      BP.log('open_detected_by_poll');
      if (findButton('Join waitlist')) { schedule(); return; } // landing() clicks it
      navigating = true;
      await BP.log('deep_link_nav'); // flush before the page unloads
      location.href = BP.FORM_URL;
    }
  } catch (e) {
    BP.log('poll_error', e.message);
  } finally {
    pollInflight = false;
  }
}

// ---------- form ----------

function form() {
  const nameEl = document.querySelector('#form_name');
  if (!nameEl || !active()) return;

  if (!formSeenAt) { formSeenAt = Date.now(); BP.log('form_seen'); }
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

  if (!submitting && findButton('Join the line')) submit();
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

  if (visibleRecaptchaChallenge()) {
    return finish('error', 'A reCAPTCHA challenge appeared. Solve it in the tab to finish.');
  }
  const alertText = [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText.trim()).filter(Boolean).join(' | ');
  const fresh = errorsIn(text).filter((p) => !watch.baseline.includes(p));
  if (alertText || fresh.length) return finish('error', alertText || `Page shows: ${fresh.join(', ')}`);

  if (Date.now() - watch.start > RESULT_TIMEOUT_MS) {
    return finish('unknown', 'No confirmation or error after 20 s. Check the tab.');
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
    buttonSeenAt = 0;
    formSeenAt = 0;
    refills = 0;
  }
  if (watch) { checkResult(); return; }

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
