// Entry point — run weekly by Task Scheduler.
//   node src/index.js            find email, parse form, submit
//   node src/index.js --dry-run  do everything EXCEPT submit; print the plan
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFormUrl } from './gmail.js';
import { parseForm, buildPrefilledUrl } from './form.js';
import { submitViaBrowser } from './submit.js';
import { notify } from './notify.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const statePath = path.join(root, 'state.json');
const dryRun = process.argv.includes('--dry-run');

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(root, 'spfd.log'), line + '\n');
}

async function main() {
  let prefilled = null;

  // 1. Hard stop: after StopDate, stop submitting and remove the scheduled task.
  if (new Date() >= new Date(cfg.stopDate + 'T23:59:59')) {
    log(`Stop date ${cfg.stopDate} reached. Disabling bot.`);
    if (process.platform === 'win32') {
      try {
        execSync(`schtasks /Delete /TN "${cfg.taskName}" /F`, { stdio: 'ignore' });
        log(`Scheduled task "${cfg.taskName}" removed.`);
      } catch { /* task may already be gone */ }
    }
    return;
  }

  // 2. Idempotency state.
  let state = { submitted: [] };
  if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  // 3. Find this week's form.
  const formUrl = await findFormUrl(cfg.gmailQuery);
  if (!formUrl) { log('No SPFD waitlist email in the last 5 days. Nothing to do.'); return; }
  log(`Found form link: ${formUrl}`);
  if (state.submitted.includes(formUrl)) { log('Already submitted this week. Skipping.'); return; }

  // 4. Parse + validate.
  const { viewUrl, entries, dayValue } = await parseForm(formUrl, cfg.dayPreference);
  const missing = ['berkeleyEmail', 'lastName', 'firstName', 'familySize', 'day'].filter((k) => !entries[k]);
  if (!dayValue) missing.push(`day-option(${cfg.dayPreference})`);
  if (missing.length) throw new Error('Could not map fields: ' + missing.join(', ') + '. Form layout may have changed.');

  prefilled = buildPrefilledUrl(viewUrl, entries, cfg, dayValue);

  // 5. Submit (or dry-run print).
  if (dryRun) {
    log(`DRY RUN — day option: "${dayValue}"`);
    log('DRY RUN — pre-filled URL:');
    console.log(prefilled);
    log('DRY RUN complete. Nothing submitted.');
    return;
  }

  const ok = await submitViaBrowser(prefilled, dayValue);
  if (!ok) throw new Error('No confirmation after submit — the saved Google login may have expired (re-run: npm run login).');

  log(`SUBMITTED successfully for "${dayValue}".`);
  state.submitted.push(formUrl);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return prefilled;
}

main().catch(async (err) => {
  log(`FAILED: ${err.message}`);
  // Failure fallback: send the 1-tap pre-filled link so you can still register.
  let msg = `⚠️ SPFD pantry bot failed: ${err.message}`;
  try {
    // Best-effort: rebuild the link for the alert if we got far enough.
    const formUrl = await findFormUrl(cfg.gmailQuery);
    if (formUrl) {
      const { viewUrl, entries, dayValue } = await parseForm(formUrl, cfg.dayPreference);
      if (dayValue && entries.day) {
        msg += `\n\nTap to register manually (Sunday):\n${buildPrefilledUrl(viewUrl, entries, cfg, dayValue)}`;
      }
    }
  } catch { /* ignore */ }
  await notify(msg);
  process.exit(1);
});
