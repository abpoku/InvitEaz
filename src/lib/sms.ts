/** Normalizes a raw, unformatted phone number (however a planner or guest typed it, e.g.
 * "555-0100") into E.164 for Twilio. Returns null rather than throwing when the input is too
 * short/garbled to confidently normalize — callers should skip that recipient. */
export function toE164(raw: string, defaultCountry = "1"): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return `+${digits}`;
  return null;
}

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
