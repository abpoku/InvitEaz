import { toE164 } from "@/lib/phone-text";

export { toE164 };

function getTwilioCreds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export async function sendSms(input: { to: string; body: string }) {
  const e164 = toE164(input.to);
  if (!e164) {
    // eslint-disable-next-line no-console
    console.log(`\n--- 📱 SMS skipped: "${input.to}" isn't a usable phone number ---\n`);
    return { delivered: false, logged: false };
  }

  const creds = getTwilioCreds();
  if (!creds) {
    // Dev / no-Twilio fallback: log so the flow is still fully testable end to end, same as
    // email.ts's SMTP-less fallback.
    // eslint-disable-next-line no-console
    console.log(`\n--- 📱 SMS (no Twilio configured, logging only) ---\nTo: ${e164}\n\n${input.body}\n--- end sms ---\n`);
    return { delivered: false, logged: true };
  }

  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: e164, From: creds.from, Body: input.body }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio send failed (${res.status}): ${text}`);
  }
  return { delivered: true, logged: false };
}

/** Whether automated server-side texting (Twilio) is set up — without it, the Messages tab only
 * offers "Text from my phone". */
export function twilioConfigured(): boolean {
  return getTwilioCreds() !== null;
}
