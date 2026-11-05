import type { SeatingGuest, SeatingItem } from "@/lib/seating";

export interface SeatingRequest {
  id: string;
  invitee_id: string;
  invitee_name: string;
  assembly_id: string | null;
  from_table_id: string | null;
  to_table_id: string | null;
  requested_by: string;
  requested_at: string;
}

/** GET /api/events/[id]/seating */
export interface SeatingData {
  items: SeatingItem[];
  usage: Record<string, { seats: number; guests: number }>;
  guests: SeatingGuest[];
  requests: SeatingRequest[];
  clones: { id: string; name: string; index: number }[];
  me: {
    role: string;
    email: string;
    assemblyId: string | null;
    canEditLayout: boolean;
    canSeat: boolean;
    canApprove: boolean;
  };
}

/** dataTransfer type for dragging guests between the guest panel and tables. */
export const GUEST_DRAG = "application/x-inviteaz-guests";
