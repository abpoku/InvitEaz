"use client";

import { useEffect, useRef, useState } from "react";
import { personalize, smsHref, isAppleDevice } from "@/lib/phone-text";

export interface PhoneRecipient {
  key: string;
  kind: "invitee" | "group";
  name: string;
  firstName: string;
  householdName?: string;
  phone: string;
  link: string;
}

function prettyPhone(e164: string) {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Step-through checklist for "Text from my phone". Each Text button is an sms: link that opens the
 * planner's own Messages app with that person's number and personalized message filled in — the
 * planner taps Send there, so it goes out from their number and replies come back to them.
 * InvitEaz can't see whether Send was pressed, so it records texts as "opened", never "sent". */
export function PhoneTextSender({
  recipients, skipped, template, eventName, onLog, onClose,
}: {
  recipients: PhoneRecipient[];
  skipped: { name: string; reason: string }[];
  template: string;
  eventName: string;
  onLog: (opened: number) => Promise<void>;
  onClose: () => void;
}) {
  const [apple, setApple] = useState(false);
  const [mobile, setMobile] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const logged = useRef(false);
  const openedRef = useRef(0);
  openedRef.current = opened.size;
  // Held in a ref so the leave-page effect below is set up once — re-running it on every new
  // onLog identity would fire its cleanup (and log) mid-way through sending.
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    setApple(isAppleDevice(navigator.userAgent));
    setMobile(/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent));
  }, []);

  // If the planner leaves mid-way, still record what they opened (keepalive survives navigation).
  useEffect(() => {
    const flush = () => {
      if (logged.current || openedRef.current === 0) return;
      logged.current = true;
      onLogRef.current(openedRef.current).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const textFor = (r: PhoneRecipient) =>
    personalize(template, { firstName: r.firstName, name: r.householdName || r.name, event: eventName, link: r.link });
  const next = recipients.find((r) => !opened.has(r.key));
  const mark = (key: string) => setOpened((prev) => new Set(prev).add(key));

  async function finish() {
    if (!logged.current && opened.size > 0) {
      logged.current = true;
      await onLog(opened.size).catch(() => {});
    }
    onClose();
  }

  async function copy(r: PhoneRecipient) {
    try {
      await navigator.clipboard.writeText(textFor(r));
      setCopied(r.key);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg text-ink">Text from your phone</h3>
          <p className="text-sm text-ink-soft">
            {opened.size} of {recipients.length} opened{skipped.length > 0 ? ` · ${skipped.length} skipped` : ""}
          </p>
        </div>
        <button onClick={finish} className="btn-secondary">{next ? "Finish for now" : "Done"}</button>
      </div>

      <div className="h-1.5 rounded bg-paper-line overflow-hidden" aria-hidden="true">
        <div className="h-full bg-moss-500 transition-all" style={{ width: `${recipients.length ? (opened.size / recipients.length) * 100 : 0}%` }} />
      </div>

      {!mobile && (
        <p className="rounded border border-brass-200 bg-brass-50 px-3 py-2 text-xs text-brass-600">
          On a computer, the Text buttons open Messages only if it&apos;s linked to your phone (a Mac with iPhone Text Message
          Forwarding, or Windows Phone Link). Otherwise, open this page on your phone — or use Copy and paste into your phone.
        </p>
      )}

      {recipients.length === 0 ? (
        <p className="text-sm text-ink-soft">No one in this audience has a usable phone number.</p>
      ) : next ? (
        <div className="rounded-lg border border-wine-200 bg-wine-50/50 p-4">
          <p className="text-xs uppercase tracking-wide text-wine-600">Next</p>
          <p className="mt-0.5 text-ink">
            {next.householdName ? <>{next.householdName} <span className="text-ink-faint">· to {next.name}</span></> : next.name}
            <span className="text-ink-faint"> · {prettyPhone(next.phone)}</span>
          </p>
          <p className="mt-2 text-sm text-ink-soft whitespace-pre-line rounded bg-white border border-paper-line px-3 py-2">{textFor(next)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={smsHref(next.phone, textFor(next), apple)} onClick={() => mark(next.key)} className="btn-primary">
              Text {next.firstName}
            </a>
            <button onClick={() => mark(next.key)} className="btn-ghost">Skip</button>
          </div>
        </div>
      ) : (
        <p className="rounded border border-moss-400/30 bg-moss-50 px-3 py-2.5 text-sm text-moss-600">
          All {recipients.length} texts opened. Replies will come to your phone.
        </p>
      )}

      {recipients.length > 0 && (
        <ul className="divide-y divide-paper-line border-y border-paper-line">
          {recipients.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className={opened.has(r.key) ? "text-ink-faint" : "text-ink"}>{r.householdName || r.name}</span>
                <span className="text-ink-faint"> · {r.householdName ? `${r.name}, ` : ""}{prettyPhone(r.phone)}</span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                {opened.has(r.key) && <span className="chip bg-moss-50 text-moss-600">Opened</span>}
                <button onClick={() => copy(r)} className="text-xs text-ink-faint hover:text-ink">{copied === r.key ? "Copied!" : "Copy"}</button>
                <a href={smsHref(r.phone, textFor(r), apple)} onClick={() => mark(r.key)} className="text-xs font-medium text-wine-500 hover:underline">Text</a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">{skipped.length} skipped — no usable phone number</summary>
          <ul className="mt-2 space-y-1 text-ink-faint">
            {skipped.map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
