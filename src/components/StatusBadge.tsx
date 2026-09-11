import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  draft: "bg-ink/[0.06] text-ink-soft",
  published: "bg-moss-50 text-moss-600",
  rsvp_closed: "bg-brass-50 text-brass-600",
  completed: "bg-ink/[0.06] text-ink-soft",
  cancelled: "bg-clay-500/10 text-clay-600",
  attending: "bg-moss-50 text-moss-600",
  declined: "bg-clay-500/10 text-clay-600",
  invited: "bg-ink/[0.06] text-ink-soft",
  opened: "bg-brass-50 text-brass-600",
  delivered: "bg-ink/[0.06] text-ink-soft",
  no_response: "bg-ink/[0.06] text-ink-faint",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  rsvp_closed: "RSVP closed",
  completed: "Completed",
  cancelled: "Cancelled",
  attending: "Attending",
  declined: "Declined",
  invited: "Invited",
  opened: "Opened",
  delivered: "Delivered",
  no_response: "No response",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("chip", STYLES[status] || "bg-ink/[0.06] text-ink-soft")}>
      {LABELS[status] || status}
    </span>
  );
}
