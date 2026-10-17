import { redirect } from "next/navigation";

/** Responses is now the Invitees tab's RSVP view. Old links and bookmarks land there, clone filter included. */
export default function ResponsesPage({ params, searchParams }: { params: { id: string }; searchParams: { clone?: string } }) {
  const qs = new URLSearchParams({ view: "rsvp", ...(searchParams.clone ? { clone: searchParams.clone } : {}) });
  redirect(`/dashboard/events/${params.id}/invitees?${qs}`);
}
