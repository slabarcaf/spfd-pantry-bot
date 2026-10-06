// Service worker: notifications + sound, toolbar badge, and keeping the Mac
// awake during watch windows while armed.
importScripts('defaults.js');

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'alert') alertUser(msg, sender.tab);
});

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
  if (cfg.armed) text = BP.isLocked(state) ? 'DONE' : watching ? 'LIVE' : 'ON';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: watching ? '#16a34a' : '#6c47ff' });
  if (watching) chrome.power.requestKeepAwake('display');
  else chrome.power.releaseKeepAwake();
}

chrome.alarms.create('refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.config || changes.state)) refresh();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);
