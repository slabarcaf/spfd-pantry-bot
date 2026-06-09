// ONE-TIME: open a visible browser so you can sign into Google with your
// Berkeley account. The session is saved under .browser-profile/ and reused by
// the weekly headless runs. Re-run this only if the saved session ever expires.
import readline from 'node:readline';
import { chromium } from 'playwright';
import { PROFILE_DIR, launchOptions } from './browser.js';

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a); });
  });

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions(false));
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://accounts.google.com/');

  console.log('\nA browser window opened.');
  console.log('  1. Sign in as santiago.labarca@berkeley.edu (complete any 2FA).');
  console.log('  2. Make sure "stay signed in" is accepted.');
  console.log('  3. Then come back here.\n');
  await ask('Press Enter once you are signed in to save the session... ');

  await ctx.close();
  console.log('Session saved to .browser-profile/. You can now run the bot.');
  process.exit(0);
})();
