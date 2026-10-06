// Pure, client-safe: the optional donations/tips note guests see on their RSVP pages.

export const DEFAULT_DONATION_MESSAGE = "This event accepts donations and tips. Contribute extra to support the event.";
export const DEFAULT_DONATIONS_LABEL = "Donations/Tips";
export const MAX_DONATION_MESSAGE = 500;

type EventLike = {
  ticketing_enabled?: number | null;
  donations_enabled?: number | null;
  donations_label?: string | null;
  donations_message_enabled?: number | null;
  donations_message?: string | null;
};

/** What a guest page should show, or null for nothing. Shown only while ticketing, the donations
 * bucket, and the message itself are all switched on; a blank message falls back to the default so
 * a ticked checkbox never shows guests an empty note. */
export function donationNoteFor(event: EventLike): { label: string; message: string } | null {
  if (!event.ticketing_enabled || !event.donations_enabled || !event.donations_message_enabled) return null;
  return {
    label: event.donations_label || DEFAULT_DONATIONS_LABEL,
    message: event.donations_message?.trim() || DEFAULT_DONATION_MESSAGE,
  };
}
