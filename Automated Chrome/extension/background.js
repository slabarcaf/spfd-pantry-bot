// Service worker: notifications + sound, toolbar badge, and keeping the Mac
// awake during watch windows while armed.
importScripts('defaults.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'alert') alertUser(msg, sender.tab);
  if (msg.type === 'claimSubmit') { claimSubmit().then(sendResponse); return true; }
  if (msg.type === 'releaseSubmit') releaseSubmit();
});

// Grant the one-submission lock to exactly one caller. Claims are chained so
// two tabs asking in the same instant are answered one after the other.
let claimChain = Promise.resolve();
function claimSubmit() {
  claimChain = claimChain.then(async () => {
    const state = await BP.getState();
    if (BP.isLocked(state)) return false;
    await chrome.storage.local.set({ state: { ...state, submittedAt: Date.now() } });
    return true;
  }).catch(() => false);
  return claimChain;
}

async function releaseSubmit() {
  const state = await BP.getState();
  delete state.submittedAt;
  await chrome.storage.local.set({ state });
}

async function alertUser({ level, title, message }, tab) {
  const id = `bp-${Date.now()}`;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
    priority: 2,
    requireInteraction: level !== 'info',
  });
  if (tab) await chrome.storage.session.set({ [id]: { tabId: tab.id, windowId: tab.windowId } });
  await playSound(level);
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { [id]: target } = await chrome.storage.session.get(id);
  if (target) {
    chrome.tabs.update(target.tabId, { active: true }).catch(() => {});
    chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
  }
  chrome.notifications.clear(id);
});

async function playSound(level) {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Alert sound when the pantry waitlist submission finishes or fails',
    });
  } catch { /* already exists */ }
  chrome.runtime.sendMessage({ type: 'play', level }).catch(() => {});
}

// Badge + keep-awake, refreshed every minute and on any config change.
async function refresh() {
  const [cfg, state] = await Promise.all([BP.getConfig(), BP.getState()]);
  const watching = cfg.armed && !BP.isLocked(state) && (!cfg.onlyInWindows || BP.inWindow(cfg));
  let text = '';
  if (cfg.armed) text = !cfg.name ? '!' : BP.isLocked(state) ? 'DONE' : watching ? 'LIVE' : 'ON';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: watching ? '#16a34a' : '#6c47ff' });
  if (watching) chrome.power.requestKeepAwake('display');
  else chrome.power.releaseKeepAwake();
  if (watching && cfg.name) await preparePantryTab();
}

// Once per day, when a watch window starts: open the pantry page in its own
// window, or reload the pantry tab that's already open. The reload matters: a
// tab opened before the extension was last reloaded/updated runs an orphaned
// script that can no longer read settings, so it would silently do nothing.
async function preparePantryTab() {
  const today = new Date().toDateString();
  const { prepared } = await chrome.storage.session.get('prepared');
  if (prepared === today) return;
  await chrome.storage.session.set({ prepared: today });

  const [tab] = await chrome.tabs.query({ url: BP.ORIGIN + BP.BASE + '*' });
  if (tab) {
    await chrome.tabs.reload(tab.id);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.windows.create({ url: BP.ORIGIN + BP.BASE, focused: true });
  }
}

// After an install or update, reload open pantry tabs so they run the new code.
async function reloadPantryTabs() {
  for (const tab of await chrome.tabs.query({ url: BP.ORIGIN + BP.BASE + '*' })) {
    chrome.tabs.reload(tab.id);
  }
}

chrome.alarms.create('refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.config || changes.state)) refresh();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(() => { reloadPantryTabs(); refresh(); });
