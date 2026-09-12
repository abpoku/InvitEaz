/* Run with: npm run db:seed
 * Creates a demo planner (demo@inviteaz.app / password123) with one sample
 * event, a few RSVP questions, and a handful of invitees so you can click
 * around the product immediately after cloning it.
 */
import { createUser, getUserByEmail } from "../src/lib/models/users";
import { createEvent, updateEvent } from "../src/lib/models/events";
import { createQuestion } from "../src/lib/models/rsvp";
import { createGroup, createInvitee, setGroupLeader } from "../src/lib/models/invitees";

async function main() {
  let user = await getUserByEmail("demo@inviteaz.app");
  if (!user) {
    user = await createUser({
      email: "demo@inviteaz.app",
      password: "password123",
      firstName: "Dana",
      lastName: "Planner",
      organization: "InvitEaz Demo",
    });
    console.log("Created demo user: demo@inviteaz.app / password123");
  } else {
    console.log("Demo user already exists — reusing it.");
  }

  const future = new Date();
  future.setDate(future.getDate() + 30);
  const dateStr = future.toISOString().slice(0, 10);

  const event = await createEvent(user.id, {
    name: "Annual Community Gala",
    date: dateStr,
    time: "18:00",
    endTime: "22:00",
    description: "An evening celebrating another great year in our community — dinner, live music, and a short program.",
    locationType: "physical",
    venueName: "The Grand Hall",
    address: "100 Main Street",
    city: "Boston",
    state: "MA",
    zip: "02108",
    country: "USA",
    organizerName: "Dana Planner",
    organizerContact: "demo@inviteaz.app",
    dressCode: "Cocktail attire",
    instructions: "Valet parking available at the north entrance.",
    visibility: "hybrid",
    groupRsvpMode: "primary_contact",
    defaultPlusOnePolicy: "one",
  });
  await updateEvent(event.id, { status: "published" });

  await createQuestion(event.id, { label: "Meal preference", type: "single_choice", options: ["Chicken", "Vegetarian", "Vegan"], required: true, showIfAttending: "yes" });
  await createQuestion(event.id, { label: "Any dietary restrictions?", type: "short_text", showIfAttending: "yes" });
  await createQuestion(event.id, { label: "Will you need transportation from the hotel block?", type: "yes_no", showIfAttending: "yes" });
  await createQuestion(event.id, { label: "Would you like updates about next year's event?", type: "yes_no", showIfAttending: "no" });

  const group = await createGroup(event.id, "Johnson Family");
  const { invitee: leader } = await createInvitee(event.id, { firstName: "Maria", lastName: "Johnson", email: "maria@example.com", groupId: group.id });
  await setGroupLeader(group.id, leader.id);
  await createInvitee(event.id, { firstName: "Tom", lastName: "Johnson", email: "tom@example.com", groupId: group.id });
  await createInvitee(event.id, { firstName: "Lily", lastName: "Johnson", isAdult: false, groupId: group.id });

  await createInvitee(event.id, { firstName: "Alex", lastName: "Rivera", email: "alex@example.com", plusOnePolicy: "one" });
  await createInvitee(event.id, { firstName: "Priya", lastName: "Nair", email: "priya@example.com", plusOnePolicy: "none" });
  await createInvitee(event.id, { firstName: "Sam", lastName: "Okafor", phone: "555-0110", plusOnePolicy: "multiple" });

  console.log(`\nDemo event created: ${event.name} (${event.id})`);
  console.log("Log in at /login with demo@inviteaz.app / password123 to explore it.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
