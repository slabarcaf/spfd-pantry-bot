// Optional Telegram alert (reuses the Melissa bot creds if present in .env).
import 'dotenv/config';

export async function notify(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
  } catch {
    /* alerting is best-effort; never throw */
  }
}
