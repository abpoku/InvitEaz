import { RsvpExperience } from "@/components/rsvp/RsvpExperience";

export default function PersonalizedRsvpPage({ params }: { params: { token: string } }) {
  return <RsvpExperience token={params.token} />;
}
