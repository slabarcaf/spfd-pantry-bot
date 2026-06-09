// Shared Playwright config. The persistent context stores the Google login
// session (cookies) under .browser-profile/ so weekly headless runs stay
// signed in. Set CHROME_CHANNEL=chrome in .env to use installed Chrome (more
// reliable for the one-time Google sign-in than bundled Chromium).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE_DIR = path.join(__dirname, '..', '.browser-profile');

export function launchOptions(headless) {
  const opts = {
    headless,
    viewport: { width: 1280, height: 900 },
    // A real UA reduces the chance of Google's "insecure browser" block.
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (process.env.CHROME_CHANNEL) opts.channel = process.env.CHROME_CHANNEL;
  return opts;
}
