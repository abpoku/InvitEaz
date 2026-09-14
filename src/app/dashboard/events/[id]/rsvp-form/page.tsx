import { notFound } from "next/navigation";
import { getMembership } from "@/lib/models/events";
import { getCurrentUser } from "@/lib/session";
import { FormBuilder } from "@/components/rsvp-form/FormBuilder";

export default async function RsvpFormPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  if (!membership || membership.role === "lead_planner") notFound();
  return <FormBuilder eventId={params.id} />;
}
