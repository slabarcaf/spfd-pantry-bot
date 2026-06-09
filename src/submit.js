// Submit the pre-filled form using the saved Google login (headless).
import { chromium } from 'playwright';
import { PROFILE_DIR, launchOptions } from './browser.js';

const CONFIRM_RE = /Your response has been recorded|Tu respuesta se ha registrado|freebirdFormviewerViewResponseConfirmation/i;

export async function submitViaBrowser(prefilledUrl, dayValue) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions(true));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(prefilledUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    // If the session expired, Google shows a "Sign in" button instead of Submit
    // (verified-email forms gate submission behind login) — the wait times out
    // and we report failure, which triggers the 1-tap fallback alert.
    let submit = page.getByRole('button', { name: /^(submit|enviar)$/i }).first();
    if (!(await submit.count())) {
      // Fallback for locale/markup variation.
      submit = page.locator('div[role="button"]').filter({ hasText: /^(Submit|Enviar)$/ }).first();
    }
    await submit.waitFor({ timeout: 15_000 });

    // Make sure the right day radio is selected (prefill usually does this).
    if (dayValue) {
      const radio = page.getByRole('radio', { name: dayValue }).first();
      if (await radio.count()) {
        if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click();
      }
    }

    await submit.click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    return CONFIRM_RE.test(await page.content());
  } finally {
    await ctx.close();
  }
}
