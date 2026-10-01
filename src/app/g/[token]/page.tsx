import { GroupRsvpExperience } from "@/components/rsvp/GroupRsvpExperience";

export default function GroupRsvpPage({ params }: { params: { token: string } }) {
  return <GroupRsvpExperience token={params.token} />;
}
