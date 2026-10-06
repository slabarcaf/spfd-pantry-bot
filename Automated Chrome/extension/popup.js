'use strict';
const $ = (id) => document.getElementById(id);
const LANDING = BP.ORIGIN + BP.BASE;

async function render() {
  const [cfg, state, { log = [] }] = await Promise.all([
    BP.getConfig(), BP.getState(), chrome.storage.local.get('log'),
  ]);
  $('armed').checked = cfg.armed;
  $('test').checked = !cfg.autoSubmit;

  const lines = [];
  if (!cfg.name) lines.push('⚠️ Set your name in Settings first. Nothing runs without it.');
  else if (!cfg.armed) lines.push('⏸ Disarmed. Nothing will happen.');
  else if (BP.isLocked(state)) {
    lines.push(`✅ Submitted at ${new Date(state.submittedAt).toLocaleTimeString()}. Locked for 3 h.`);
  } else if (!cfg.onlyInWindows || BP.inWindow(cfg)) {
    lines.push(cfg.autoSubmit ? '🟢 Watching now. Will join as soon as it opens.' : '🟡 Watching now (test mode: fill only).');
  } else lines.push(`🕒 Armed. Next watch window: ${BP.nextWindow(cfg)} PT (−${cfg.leadMinutes} min).`);
  if (cfg.armed && cfg.name) lines.push('Chrome must be running and the Mac awake, lid open, plugged in. The pantry tab opens by itself when watching starts.');
  $('status').textContent = lines.join('\n');
  $('status').style.whiteSpace = 'pre-line';

  $('log').textContent = log.slice().reverse().map((e) => {
    const t = new Date(e.at);
    const stamp = t.toLocaleTimeString([], { hour12: false }) + '.' + String(t.getMilliseconds()).padStart(3, '0');
    return `${stamp}  ${e.event}${e.detail ? ' · ' + e.detail : ''}`;
  }).join('\n') || 'No events yet.';
}

$('armed').onchange = (e) => BP.setConfig({ armed: e.target.checked });
$('test').onchange = (e) => BP.setConfig({ autoSubmit: !e.target.checked });

$('open').onclick = async () => {
  const [tab] = await chrome.tabs.query({ url: LANDING + '*' });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: LANDING });
  }
  window.close();
};

$('testFill').onclick = async () => {
  await chrome.tabs.create({ url: BP.ORIGIN + BP.FORM_URL + '#bp-test' });
  window.close();
};

$('unlock').onclick = async () => {
  const state = await BP.getState();
  delete state.submittedAt;
  await chrome.storage.local.set({ state });
  BP.log('lock_reset', 'from popup');
};

$('options').onclick = () => chrome.runtime.openOptionsPage();
$('clear').onclick = () => chrome.storage.local.set({ log: [] });

chrome.storage.onChanged.addListener(render);
render();
