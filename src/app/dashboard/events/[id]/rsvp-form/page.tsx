import { FormBuilder } from "@/components/rsvp-form/FormBuilder";

export default function RsvpFormPage({ params }: { params: { id: string } }) {
  return <FormBuilder eventId={params.id} />;
}
