// Pure, client-safe helpers for "Text from my phone": InvitEaz never sends these texts itself — it
// opens the planner's own Messages app (an sms: link) with the recipient and message filled in, so
// the text goes out from the planner's number through their carrier and replies come back to them.

/** Normalizes a raw phone number (however it was typed, e.g. "555-0100") into E.164. Returns null
 * when it's too short/garbled to use. Shared with server-side SMS (src/lib/sms.ts). */
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

/** Fills {first_name}, {name}, {event} and {link}. If the planner's message has no {link}, the
 * RSVP link is appended — a text that can't be acted on would defeat the purpose. */
export function personalize(template: string, vars: { firstName: string; name: string; event: string; link: string }): string {
  const hasLink = /\{link\}/i.test(template);
  const filled = template
    .replace(/\{first_name\}/gi, vars.firstName)
    .replace(/\{name\}/gi, vars.name)
    .replace(/\{event\}/gi, vars.event)
    .replace(/\{link\}/gi, vars.link)
    .trim();
  return hasLink ? filled : `${filled}${filled ? "\n" : ""}${vars.link}`;
}

/** Apple's Messages (iPhone, iPad, and a Mac relaying through an iPhone) expects `sms:NUMBER&body=`;
 * Android and others expect `sms:NUMBER?body=`. */
export function isAppleDevice(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Macintosh/i.test(userAgent);
}

export function smsHref(phoneE164: string, body: string, apple: boolean): string {
  return `sms:${phoneE164}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

/** Short, text-sized starting points for each message type (emails keep their own, longer ones). */
export const PHONE_TEMPLATES: Record<string, string> = {
  invitation: "Hi {first_name}! You're invited to {event}. Please RSVP here: {link}",
  reminder: "Hi {first_name}, a friendly reminder to RSVP for {event}: {link}",
  final_reminder: "Hi {first_name}, last chance to RSVP for {event} — RSVPs close soon: {link}",
  event_update: "Hi {first_name}, there's an update for {event}. See the latest details: {link}",
  custom: "",
};
