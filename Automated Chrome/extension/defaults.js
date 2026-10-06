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
    name: 'Santiago Labarca',
    phone: '(415) 710-2860',
    email: 'santiago.labarca@berkeley.edu',
    armed: false,        // master switch; arm from the popup
    autoSubmit: true,    // false = test mode: fill the form, never click "Join the line"
    onlyInWindows: true, // only act during the watch windows below
    leadMinutes: 10,     // start watching this many minutes before a window
    windows: [           // Pacific time; day 0 = Sunday
      { day: 1, start: '12:00', end: '14:00' },
      { day: 2, start: '16:00', end: '18:00' },
      { day: 4, start: '13:00', end: '16:00' },
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

  // Current weekday + minutes-since-midnight in Pacific time.
  nowPT(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BP.TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return { day: BP.DAYS.indexOf(get('weekday')), minutes: +get('hour') * 60 + +get('minute') };
  },

  inWindow(cfg, d = new Date()) {
    const { day, minutes } = BP.nowPT(d);
    return cfg.windows.some((w) => w.day === day
      && minutes >= BP.toMin(w.start) - cfg.leadMinutes
      && minutes < BP.toMin(w.end));
  },

  // Human label for the next window start, e.g. "Tue 16:00".
  nextWindow(cfg) {
    const { day, minutes } = BP.nowPT();
    let best = null;
    for (const w of cfg.windows) {
      let ahead = (w.day - day + 7) % 7 * 1440 + BP.toMin(w.start) - cfg.leadMinutes - minutes;
      if (ahead < 0) ahead += 7 * 1440;
      if (!best || ahead < best.ahead) best = { ahead, w };
    }
    return best ? `${BP.DAYS[best.w.day]} ${best.w.start}` : 'none configured';
  },

  formatWindows(windows) {
    return windows.map((w) => `${BP.DAYS[w.day]} ${w.start}-${w.end}`).join('\n');
  },

  // "Mon 12:00-14:00" per line -> [{day, start, end}]
  parseWindows(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(\w{3})\w*\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      const day = m && BP.DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase());
      if (!m || day < 0) throw new Error(`Bad window line: "${line}" (expected e.g. "Mon 12:00-14:00")`);
      const pad = (t) => t.padStart(5, '0');
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
