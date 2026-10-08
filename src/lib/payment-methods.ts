// Pure, client-safe: shared by the Receive/Edit payment modals and the payments API.

/** The types a planner can pick, in dropdown order. */
export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cashapp", label: "CashApp" },
  { value: "venmo", label: "Venmo" },
  { value: "zelle", label: "Zelle" },
  { value: "check", label: "Check" },
  { value: "other", label: "Other" },
] as const;

/** Types that can no longer be chosen but are still stored on older payments. They keep their label
 * everywhere, and Edit offers them only on a payment that already has one, so the planner can switch
 * it to a current type (e.g. "CashApp/Venmo" → CashApp or Venmo). */
export const LEGACY_PAYMENT_METHODS = [
  { value: "cashapp_venmo", label: "CashApp/Venmo" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return PAYMENT_METHODS.some((m) => m.value === v);
}

export function isLegacyPaymentMethod(v: unknown): boolean {
  return LEGACY_PAYMENT_METHODS.some((m) => m.value === v);
}

/** "Other" always shows the planner's own description (required when recording one). */
export function paymentMethodLabel(method: string | null, other?: string | null): string {
  if (!method) return "—";
  if (method === "other") return other ? `Other — ${other}` : "Other";
  return [...PAYMENT_METHODS, ...LEGACY_PAYMENT_METHODS].find((m) => m.value === method)?.label || method;
}

/** Today as YYYY-MM-DD in the *viewer's* timezone — what "today" means to the planner typing it,
 * unlike toISOString(), which would roll over to tomorrow every evening in the Americas. */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Payment dates can be backdated but not in the future. Checked on the server against UTC "today"
 * plus one day of slack, so a planner west of UTC late in the evening (whose local "today" is still
 * yesterday in UTC — or, east of UTC, already tomorrow) is never rejected for entering their own today. */
export function isFutureDate(v: string): boolean {
  const limit = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return v > limit;
}

/** Shared by the payments API's POST and PATCH: validates the date/type fields when present
 * (`partial`) or requires them (create). Returns an error message, or null when valid. `currentMethod`
 * (edits only) is the payment's stored type: re-saving an unchanged legacy type is allowed, so editing
 * just the amount or date of an old payment doesn't force a new type on it. */
export function validatePaymentDetails(body: any, partial: boolean, currentMethod?: string | null): string | null {
  if (!partial || body.paidOn !== undefined) {
    if (!isIsoDate(body.paidOn)) return "Choose the date this payment was received.";
    if (isFutureDate(body.paidOn)) return "The payment date can't be in the future.";
  }
  if (!partial || body.method !== undefined) {
    const unchangedLegacy = partial && isLegacyPaymentMethod(body.method) && body.method === currentMethod;
    if (!isPaymentMethod(body.method) && !unchangedLegacy) return "Choose a payment type.";
    if (body.method === "other" && !(typeof body.methodOther === "string" && body.methodOther.trim())) {
      return "Describe the payment type for \"Other\".";
    }
  }
  return null;
}
