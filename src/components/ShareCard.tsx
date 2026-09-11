"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function ShareCard({ slug, visibility, status }: { slug: string; visibility: string; status: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/e/${slug}`);
  }, [slug]);

  if (visibility === "invite_only") {
    return (
      <div className="card p-6">
        <p className="font-serif text-lg text-ink">Sharing</p>
        <p className="mt-2 text-sm text-ink-soft">
          This event is invitation-only. Each invitee gets their own personal RSVP link automatically —
          add invitees on the Invitees tab and send invitations from Messages.
        </p>
      </div>
    );
  }

  if (status !== "published") {
    return (
      <div className="card p-6">
        <p className="font-serif text-lg text-ink">Sharing</p>
        <p className="mt-2 text-sm text-ink-soft">Publish the event to activate its open RSVP link.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <p className="font-serif text-lg text-ink">Open RSVP link</p>
      <p className="mt-2 text-sm text-ink-soft">Anyone with this link can RSVP.</p>
      <div className="mt-4 flex items-center justify-center bg-white p-4 rounded border border-paper-line">
        {url && <QRCodeSVG value={url} size={140} fgColor="#1E2233" />}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input readOnly value={url} className="input text-xs" />
        <button
          className="btn-secondary shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
