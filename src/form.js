// Fetch a Google Form, parse its structure, and build a pre-filled link.
//
// Each week the form is regenerated (new URL, new entry.* ids, new dated day
// labels), so we resolve + parse it fresh every run. The field/entry mapping
// lives in FB_PUBLIC_LOAD_DATA_ (a JSON blob in the page); we match each
// question to a logical field by keyword so weekly wording changes don't break it.

export async function parseForm(formUrl, dayPreference) {
  const res = await fetch(formUrl, { redirect: 'follow' });
  const html = await res.text();
  const viewUrl = res.url; // resolved (post-redirect) viewform URL

  const respM = html.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/formResponse/);
  if (!respM) throw new Error('Could not find the formResponse URL in the form HTML.');
  const responseUrl = respM[0];

  const dataM = html.match(/var FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);<\/script>/);
  if (!dataM) throw new Error('Could not find FB_PUBLIC_LOAD_DATA_ in the form HTML.');
  const data = JSON.parse(dataM[1]);
  const questions = data[1][1];

  const entries = {};
  let dayValue = null;

  for (const q of questions) {
    const title = (q[1] || '').toLowerCase();
    for (const f of q[4] || []) {
      const id = f[0];
      const opts = f[1];
      if (title.includes('berkeley email')) entries.berkeleyEmail = id;
      else if (title.includes('last name')) entries.lastName = id;
      else if (title.includes('first name')) entries.firstName = id;
      else if (title.includes('family') || title.includes('how many people')) entries.familySize = id;
      else if (opts) {
        // The day radio is the only question carrying options.
        entries.day = id;
        for (const o of opts) {
          const label = o[0];
          if (dayPreference === 'Both') {
            if (label === 'Both') dayValue = label;
          } else if (label.startsWith(dayPreference)) {
            dayValue = label;
          }
        }
      }
    }
  }

  return { viewUrl, responseUrl, entries, dayValue };
}

// Build a viewform URL with answers pre-filled (?usp=pp_url&entry.X=...).
// Opening it (while signed in) shows the form ready to submit with one click.
export function buildPrefilledUrl(viewUrl, entries, cfg, dayValue) {
  const base = viewUrl.split('?')[0];
  const p = new URLSearchParams();
  p.set('usp', 'pp_url');
  p.set(`entry.${entries.berkeleyEmail}`, cfg.berkeleyEmail);
  p.set(`entry.${entries.lastName}`, cfg.lastName);
  p.set(`entry.${entries.firstName}`, cfg.firstName);
  p.set(`entry.${entries.familySize}`, cfg.familySize);
  p.set(`entry.${entries.day}`, dayValue);
  return `${base}?${p.toString()}`;
}
