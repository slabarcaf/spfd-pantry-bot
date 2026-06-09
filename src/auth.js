// OAuth: exchange the Berkeley refresh token for a short-lived access token.
// Same pattern as melissa-bot/sheets-mcp.js (getAccessToken).
import 'dotenv/config';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN_BERKELEY;

let cache = { token: null, expiry: 0 };

export async function getAccessToken() {
  if (!REFRESH_TOKEN) throw new Error('Missing GOOGLE_REFRESH_TOKEN_BERKELEY in .env');
  if (cache.token && Date.now() < cache.expiry - 60_000) return cache.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('OAuth error: ' + (data.error_description || data.error || 'no access_token'));
  }
  cache = { token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
  return cache.token;
}
