// Shared config + helpers. Loaded by the content script, the service worker
// (importScripts), the popup and the options page.
'use strict';

const BP = {
  ORIGIN: 'https://waitwhile.com',
  BASE: '/locations/bearpantry',
  FORM_URL: '/locations/bearpantry/details?registration=waitlist',
  TZ: 'America/Los_Angeles',
  DAYS: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  LOCK_MS: 3 * 60 * 60 * 1000, // never submit twice within 3 h
  LOG_MAX: 60,

  DEFAULTS: {
    name: '',            // required by the form; set in Settings
    phone: '',           // optional
    email: '',           // optional
    armed: false,        // master switch; arm from the popup
    autoSubmit: true,    // false = test mode: fill the form, never click "Join the line"
    onlyInWindows: true, // only act during the watch windows below
    leadMinutes: 10,     // start watching this many minutes before a window
    windows: [           // Pacific time; day 0 = Sunday; start = actual go-live time
      { day: 1, start: '11:30', end: '14:00' },               // every Monday
      { date: '2026-10-06', start: '15:30', end: '18:00' },   // one-off trial run (Tue)
    ],
  },

  async getConfig() {
    const { config } = await chrome.storage.local.get('config');
    return { ...BP.DEFAULTS, ...config };
  },

  async setConfig(patch) {
    const cfg = await BP.getConfig();
    await chrome.storage.local.set({ config: { ...cfg, ...patch } });
  },

  async getState() {
    const { state } = await chrome.storage.local.get('state');
    return state || {};
  },

  isLocked(state) {
    return !!state.submittedAt && Date.now() - state.submittedAt < BP.LOCK_MS;
  },

  toMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  },

  // Current weekday, date (YYYY-MM-DD) and minutes-since-midnight in Pacific time.
  nowPT(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BP.TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return {
      day: BP.DAYS.indexOf(get('weekday')),
      date: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: +get('hour') * 60 + +get('minute'),
    };
  },

  // A window is weekly ({day}) or one-off ({date}).
  appliesOn(w, now) {
    return w.date ? w.date === now.date : w.day === now.day;
  },

  inWindow(cfg, d = new Date()) {
    const now = BP.nowPT(d);
    return cfg.windows.some((w) => BP.appliesOn(w, now)
      && now.minutes >= BP.toMin(w.start) - cfg.leadMinutes
      && now.minutes < BP.toMin(w.end));
  },

  // Human label for the next window start, e.g. "Mon 11:30" or "2026-10-06 15:30".
  nextWindow(cfg, d = new Date()) {
    const now = BP.nowPT(d);
    for (let i = 0; i < 8; i++) {
      const on = BP.nowPT(new Date(d.getTime() + i * 864e5));
      const next = cfg.windows
        .filter((w) => BP.appliesOn(w, on) && (i > 0 || BP.toMin(w.start) - cfg.leadMinutes > now.minutes))
        .sort((a, b) => BP.toMin(a.start) - BP.toMin(b.start))[0];
      if (next) return BP.label(next);
    }
    return 'none in the next week';
  },

  label(w) {
    return `${w.date || BP.DAYS[w.day]} ${w.start}`;
  },

  formatWindows(windows) {
    return windows.map((w) => `${BP.label(w)}-${w.end}`).join('\n');
  },

  // One per line: "Mon 11:30-14:00" (weekly) or "2026-10-06 15:30-18:00" (one-off)
  parseWindows(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(\d{4}-\d{2}-\d{2}|\w{3})\w*\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      const pad = (t) => t.padStart(5, '0');
      if (m && /^\d{4}-/.test(m[1])) return { date: m[1], start: pad(m[2]), end: pad(m[3]) };
      const day = m ? BP.DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase()) : -1;
      if (day < 0) throw new Error(`Bad window line: "${line}" (expected "Mon 11:30-14:00" or "2026-10-06 15:30-18:00")`);
      return { day, start: pad(m[2]), end: pad(m[3]) };
    });
  },

  // Append to the persistent log. Writes are chained so concurrent calls from
  // one context never clobber each other.
  _logChain: Promise.resolve(),
  log(event, detail = '') {
    const entry = { at: Date.now(), event, detail: String(detail) };
    console.log('[BearPantry]', new Date(entry.at).toISOString(), event, detail);
    BP._logChain = BP._logChain.then(async () => {
      const { log = [] } = await chrome.storage.local.get('log');
      log.push(entry);
      await chrome.storage.local.set({ log: log.slice(-BP.LOG_MAX) });
    }).catch(() => {});
    return BP._logChain;
  },
};
