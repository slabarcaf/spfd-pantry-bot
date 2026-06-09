// Find the newest SPFD waitlist email and extract the Google Form link.
import { getAccessToken } from './auth.js';

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Gmail messages are MIME trees; gather every leaf body and decode it.
function collectBody(part) {
  let out = '';
  if (part.body?.data) out += b64urlDecode(part.body.data);
  if (part.parts) for (const p of part.parts) out += collectBody(p);
  return out;
}

export async function findFormUrl(query) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`,
    { headers },
  );
  const list = await listRes.json();
  if (list.error) throw new Error('Gmail list error: ' + JSON.stringify(list.error));
  if (!list.messages?.length) return null;

  // messages come back newest-first
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${list.messages[0].id}?format=full`,
    { headers },
  );
  const msg = await msgRes.json();
  if (msg.error) throw new Error('Gmail get error: ' + JSON.stringify(msg.error));

  const body = collectBody(msg.payload || {});
  const gle = body.match(/https:\/\/forms\.gle\/[A-Za-z0-9]+/);
  if (gle) return gle[0];
  const full = body.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform/);
  return full ? full[0] : null;
}
