// ONE-TIME (only if needed): mint a Berkeley refresh token with gmail.readonly.
// Run if Gmail calls fail with a 403 insufficient-scope error. Uses the loopback
// OAuth flow with the SAME Google client as Melissa.
import 'dotenv/config';
import http from 'node:http';
import { exec } from 'node:child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });

const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code.'); return; }

  res.end('<h2>Done. Return to the terminal.</h2>');
  server.close();

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const tok = await tokRes.json();
  if (!tok.refresh_token) {
    console.error('No refresh_token returned. Revoke prior access at ' +
      'https://myaccount.google.com/permissions and retry.', tok);
    process.exit(1);
  }
  console.log('\n================ REFRESH TOKEN ================');
  console.log(tok.refresh_token);
  console.log('==============================================');
  console.log('Paste it into .env as GOOGLE_REFRESH_TOKEN_BERKELEY.');
  process.exit(0);
});

server.listen(PORT, () => {
  console.log('Opening browser for Google consent...');
  console.log('If it does not open, paste this URL:\n' + authUrl + '\n');
  exec(`${opener} "${authUrl}"`);
});
