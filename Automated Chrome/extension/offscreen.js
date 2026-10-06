// Plays alert tones for the service worker (which has no audio of its own).
const TONES = {
  success: [660, 880, 1320],
  error: [880, 440, 880, 440, 880, 440],
  info: [660],
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'play') return;
  const ctx = new AudioContext();
  const notes = TONES[msg.level] || TONES.info;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime + i * 0.22;
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
  setTimeout(() => ctx.close(), notes.length * 220 + 300);
});
