# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server (localhost:3000)
npm run build     # production build
npm start         # run production build
npm run lint      # next lint
npm run db:seed   # populate demo data (tsx scripts/seed.ts) — then log in as demo@inviteaz.app / password123
```

There is no test suite in this repo. There's no separate migration command either —
`src/lib/schema.sql` is applied automatically against `DATABASE_URL` the first time the
process handles a query (see Schema changes below).

Requires a Postgres database (`DATABASE_URL`) and `NEXTAUTH_SECRET` in `.env.local`
(copy from `.env.example`). Without `SMTP_HOST` set, outgoing email is logged to the
console instead of sent, so email-dependent flows are testable with zero setup.

**Manual verification pattern used throughout this project's history**: for anything
touching auth, permissions, or the schema-migration path, spin up a local Postgres
(`brew services start postgresql@16`, `createdb <name>`), point `DATABASE_URL` at it, and
drive the actual app end-to-end — either via `curl` with a real login cookie jar, or via a
disposable Playwright script in the scratchpad directory (`npm install playwright
--no-save` there, then `chromium.launch()`) for anything that needs a real browser (client
components, modals). Both approaches have caught real bugs that code review alone missed —
see "Known gotchas" below.

## Architecture

Next.js 14 App Router + TypeScript + Tailwind. No ORM: `src/lib/db.ts` wraps a `pg` Pool,
and `src/lib/models/*.ts` hold hand-written SQL per entity (events, invitees, rsvp,
assemblies, comms, users, invitee-fields, ticketing). Model queries are written with `?` placeholders
(a holdover from an earlier SQLite version) — `query()`/`exec()` in `db.ts` rewrite them to
Postgres's `$1, $2…` at call time; keep using `?` in new queries rather than mixing styles.
Timestamps are plain ISO-8601 `TEXT`, not native `Date`/`timestamptz`, so every value is
predictable across drivers/environments — don't switch a column to a Postgres date type
without updating every reader.

Auth is NextAuth credentials-provider with bcrypt + JWT sessions (`src/lib/auth.ts`), no
external auth service. The app is deployed to Vercel with auto-deploy on push to `main`
(no separate deploy step needed) and Postgres via Neon.

**"Assembly" vs "Clone"**: the product now calls this concept "Clone" everywhere in the UI,
but every internal identifier — the `assemblies` table, `assembly_id` columns,
`AssembliesManager.tsx`, `requireAssemblyScope`, API routes under `/api/events/[id]/assemblies` —
is still spelled "assembly". This was a deliberate choice (a real rename touches 300+
call sites and a live FK'd table for zero functional gain); when working in this area,
translate mentally rather than expecting the code to say "clone".

### Permission model

Two independent gates in `src/lib/session.ts`, both keyed off `getMembership()` in
`models/events.ts`:

- `requireEventRole(eventId, minRole)` — ranks `viewer(0) < admin(1) < owner(2)` for
  full-event actions (settings, RSVP form, invitee-field config, co-planners,
  publish/delete). `lead_planner` and `co_planner` have no rank and always fail this check
  by design.
- `requireAssemblyScope(eventId)` — for clone-scoped actions (invitees, groups, messages,
  responses/reports, and the members endpoints' own restricted path — see below).
  Full-event roles get `assemblyId: null` (unrestricted); a `lead_planner`/`co_planner` is
  confined to the one assembly their `event_members` row names.

Four roles total: `owner` (master planner, full authority), `admin`, `viewer` (both
full-event, ranked), `lead_planner` (scoped to one clone, full day-to-day access to that
clone's invitees/groups/messages/reports, no staffing authority), and `co_planner` (same
day-to-day access as a lead planner, no staffing authority at all — up to 3 per clone).
Use the exported `isCloneScopedRole(role)` helper from `models/events.ts` (not a literal
`role === "lead_planner"` check) anywhere access needs to be restricted to "this person's
one clone" — it already covers both scoped roles and is the single source of truth every
page/route uses for this. **Never import a value (only `import type`) from
`models/events.ts` into a `"use client"` component** — that module's other exports pull in
`@/lib/db` (`pg`), which must never reach a client bundle; inline the two-role check
directly if a client component needs it (see `EventTabs.tsx`).

Only the event owner can add/remove `admin`/`viewer`/`lead_planner`, but a clone's own
`lead_planner` can additionally add/remove `co_planner`s scoped to their own clone (see
`POST`/`DELETE /api/events/[id]/members[/​[memberId]]` — both routes try full owner
authority first, then fall back to this restricted path).

### Core data model

- **Event** → optionally split into **Clones** (internally: Assemblies — e.g. multiple
  congregations/branches attending one event), each with its own scoped `lead_planner` and
  up to 3 `co_planner`s.
- **Invitee** — a guest, optionally in a **Group** (for household/plus-one handling) and
  optionally tagged to a **Clone**. Planner-defined custom fields live in
  `invitees.custom_fields` (JSON, `{fieldKey: value}`) with definitions in `invitee_fields`;
  matching uploaded-spreadsheet columns to these fields is handled by
  `src/lib/invitee-field-matching.ts`, and the downloadable template
  (`invitees/template/route.ts`) builds its columns from the same `invitee_fields` list, so
  the two always stay in sync automatically — see the CSV-escaping gotcha below for the one
  way this used to break.
- `invitee_fields` and `rsvp_questions` **both** use the same `kind: "core" | "custom"` +
  stable `key` pattern: core rows are seeded once per event (`seedDefaultsIfMissing()` /
  `seedRsvpQuestionDefaultsIfMissing()`), can have their `label` reworded and
  `required`/`active`/`order_index` toggled, but never their `field_type`/`options`/`type` —
  the rest of the app (headcount math, plus-one caps, the RSVP form, reports) depends on
  those staying exactly as-is. `rsvp_questions`' `attending` key is further locked: it can't
  even be hidden or made optional, since it feeds the dedicated `rsvp_responses.attending`
  column everything else reads.
- **Invitation** — a unique non-guessable `token` connecting an invitee to an event; the
  personalized RSVP page is `/r/[token]`. Public/open events also allow self-signup via
  `/e/[slug]`.
- **RSVP Response** + free-form **Answers** to planner-defined **Questions**
  (`rsvp_questions`), shown/hidden per-question via `show_if_attending`. A response's
  `rsvp_status` is `attending | declined | maybe` — see RSVP status & manual entry below.
- **Ticket Tiers** + **Ticket Payments** — optional per-event pricing (no payment
  processing) — see Ticketing below.
- **Communications** — a log of every email sent (type + recipients + body), scopable to
  one clone. **EventMembers** carries every role above. **AuditLog** records actions.

**Groups are identified by name within a clone.** `POST /api/events/[id]/groups` is
find-or-create (`findGroupByName`: same event, same clone or both unassigned, name compared
ignoring case/surrounding spaces) — the same rule the spreadsheet upload already used. Before this,
the Add/Edit Invitee form created a brand-new group on every save, so adding a household one person
at a time produced one single-member group per person. Duplicates that already exist are combined
with **Merge** in the Invitees tab's Group view (`POST .../groups/merge` → `mergeGroups`): members and
group-tagged payments move to the kept group (moved *before* the emptied groups are deleted, since
`ticket_payments.group_id` is `ON DELETE CASCADE`), and each merged-away group's `/g/[token]` link
becomes a row in `group_link_aliases` pointing at the kept group, so links already sent keep working.

**Group RSVP — two paths.** (1) The legacy *individual-link* path (intentional, not a bug):
when `group_rsvp_mode` is `group` or `primary_contact`, whichever member opens their own `/r/[token]`
link first can RSVP for the household; that response is recorded against *their* invitation only —
other members' rows stay `no_response`. (2) The **group link** (`/g/[token]`,
`src/lib/models/group-rsvp.ts`, `GroupRsvpExperience.tsx`, "Copy group link" on the Invitees tab's
group view) has none of that simplification: each member gets their own attending/not-attending,
their own answers to the custom RSVP questions, and their own `rsvp_responses` row on their own
invitation (`num_attending` 1/0), so stats and reports are exact per person. Its token is
`groups.rsvp_token`, filled by a column `DEFAULT` (every group has one; nothing has to set it).
Specifics:
- Name edits and guest-editable invitee fields write straight to the invitee. Guest-editable means
  `active && collect_at_signup`, minus `group`, `plus_one_policy`, and the linked ticketing field
  (`guestEditableFields()`). Custom-field writes only touch the keys the guest was shown.
- Guests can add people only within the event's **guest allowance** (`events.guest_allowance_mode`
  `none | per_person | per_group` + `guest_allowance_count`; pure helpers in
  `src/lib/guest-allowance.ts`, set from Settings / new-event). `per_person` sums each planner-added
  member's allowance (honoring their `plus_one_policy` override); guest-added members
  (`invitees.added_by_guest = 1`) never earn allowance and are the only ones a guest may remove
  (soft delete). Plan invitee limits still apply. `default_plus_one_policy` is now *derived* from the
  allowance on every write (`legacyPolicyFor`) — don't write it on its own.
- When ticketing is on, the link also shows the group's ticket price, amount paid, and balance,
  from `getGroupTicketBalance()` in `ticketing.ts` — it shares `groupTotals()` with the Tickets
  tab's group rows, so the guest and the planner always see the same numbers. Read-only for guests.
- The submit validates everything before writing anything, and rejects (409) a member list that
  doesn't match the group's current members, so a stale tab can't silently skip someone.
- Still true for both paths: `groups.leader_invitee_id` (settable via the template's "Group Leader"
  column) is write-only — nothing reads it.

### Invitee CSV upload

`src/components/invitees/UploadModal.tsx` is a multi-step wizard (`select → map → review →
fix/duplicates → done`) backed by `src/app/api/events/[id]/invitees/upload/route.ts`
(preview, no DB writes) and `.../upload/confirm/route.ts` (the actual import). Column
matching and validation are pure functions in `src/lib/invitee-field-matching.ts` so the
client can re-validate instantly after the planner adjusts a column mapping, with no round
trip.

- **Duplicate detection is whole-event, not assembly-scoped**, and checks both against rows
  already in the file and against invitees already in the database (email → phone → name,
  in that priority) — a lead/co-planner's upload can still collide with a duplicate sitting
  in a different clone, which is exactly the mistake this needs to catch. Every duplicate
  needs an explicit planner decision (Keep both / Merge / Skip) — nothing is silently
  skipped or silently overwritten. A merge only ever unconditionally overwrites the fields
  actually shown in the merge picker (name/email/phone); every other field on the target
  invitee (notes, group, custom fields) is preserved unless the uploaded row actually
  supplies a non-empty value — this bit through us once already (a merge that fills in a
  missing phone number used to also blank out an existing `notes` value from an unrelated
  edit) and is exactly the kind of "which side wins" bug to watch for if this logic changes.
- **Missing/invalid data is advisory, not blocking** — a summary banner ("N of M rows
  missing X") offers Continue-anyway or Fix-before-upload (inline per-row editing, plus
  bulk multi-select edit reusing the same pattern as the live Invitees page — see below).
  When building the per-field summary, don't let two different validation rules that can
  both fire for the same field on the same row (e.g. "email is individually required" and
  "at least one of email/phone is required") both push an issue — a row can otherwise get
  double-counted in that field's total, which is exactly what happened here (one row
  reported twice made "97 of 107 rows missing Phone" read "194 of 107").
- **Bulk multi-select editing** (`src/components/invitees/BulkEditModal.tsx` +
  `groupCounts()` in `src/lib/bulk-select.ts`) is a genuinely shared component: it's used
  both inside the upload wizard's fix step (mutating in-memory preview rows, no network
  call) and on the live Invitees page (`InviteesManager.tsx`, real `PATCH
  /api/events/[id]/invitees/bulk`) — it's parameterized entirely through an `onApply`
  callback so the caller decides whether a field-value change is persisted immediately or
  just held in local state. The live Invitees page's bulk route (and its sibling bulk
  `DELETE`, a soft `deactivateInvitee` per selected id) follow the same
  scope-check-and-skip pattern as every other assembly-scoped bulk route: an out-of-scope id
  is silently dropped from the write and reported back via a `skipped` count, rather than
  failing the whole request.

### RSVP status & manual entry

Guests self-submit via the public `/r/[token]` form, which stays a strict binary
Attending/Declined — never touched by anything below. Separately, planners can now record a
status on an invitee's behalf from the Responses tab (`src/components/responses/
ResponsesManager.tsx`, which lists **every** invitee for the event, not just ones who've
actually responded — contrast with `listResponsesForEvent` in `rsvp.ts`, which still only
returns invitations with a response row and backs the CSV export).

- **A third status, "Maybe", is a real tri-state**, not just a UI label — it gets its own
  bucket in every stat (`EventStats`/`AssemblyStats` both carry a `maybe` field alongside
  `attending`/`declined`) rather than being lumped into declined. `rsvp_responses` gained an
  `rsvp_status: 'attending' | 'declined' | 'maybe'` column for this; the legacy boolean
  `attending` column is still written on every insert (1 only for real attending) so nothing
  that reads it directly needed to change. "Maybe" is **planner-only** — it's never an
  option the public form itself offers.
- **A manual "Attending" behaves exactly like a real guest submission** for stats purposes:
  `recordManualResponse()` (`src/lib/models/rsvp.ts`) inserts a real `rsvp_responses` row
  (not just an `invitations.status` flip), because `getEventStats`/`getAssemblyStats`
  compute headcount by reading each invitation's *latest* response row, never
  `invitations.status` directly — a manual entry that only touched the status column would
  silently not count toward "Attending" or "Total attendees" anywhere.
- **A later guest submission always wins over a planner's manual entry**, with zero special
  locking logic: every response path (`submitResponse` for guests, `recordManualResponse`
  for planners) always `INSERT`s a new row rather than updating one in place, and everything
  reads "latest by `responded_at`" — so a guest who shows up and RSVPs themselves after a
  planner recorded something on their behalf just becomes the new latest row automatically.
  `rsvp_responses.recorded_by` (planner's email, `NULL` for real guest submissions) is the
  only place this distinction is visible.

### Ticketing

No payment processing anywhere — `ticketing_enabled`/`ticket_field_id` (on `events`),
`ticket_tiers`, and `ticket_payments` exist purely to record configured prices and manually
track who's paid. Managed from `src/components/ticketing/TicketingManager.tsx` on the
Overview tab (full-event only — gated `requireEventRole(id, "admin")`, same as the rest of
Overview's config sections; clone-scoped roles never see it).

- **Tiers are authored on the Ticketing card, not on the linked field.** A planner adds
  tiers (name + price) directly; the *field*'s dropdown options are a byproduct, kept in
  sync automatically by `createTier`/`deleteTier` in `src/lib/models/ticketing.ts` calling
  `updateInviteeField()` under the hood. This inverted an earlier version of the feature
  that required creating the field first (via Manage Fields) and pricing its existing
  options after — that direction caused a two-tab round trip and a "drift" state (field
  options edited elsewhere no longer matching configured prices) that needed its own
  reconciliation UI. The current one-way design has no drift to detect: once a field is
  linked, editing its `options` directly through `PATCH
  /api/events/[id]/invitee-fields/[fieldId]` is rejected outright (see the guard in that
  route) — the tier list is the only way to change them. First tier added with no field
  linked yet auto-creates one (an ordinary custom dropdown field, `collect_at_signup:
  false` by default); an already-existing dropdown field can be "adopted" instead
  (`adoptFieldAsTicketing`), seeding its current options as $0 tiers. Tier *names* are
  immutable after creation (only price can change) — renaming would mean reconciling every
  invitee already holding the old option string, so delete-and-recreate is the intended path
  if a name is wrong.
- **An invitee's assigned tier is just their value for that (ordinary) custom field** —
  `custom_fields[field.key]`. `priceForInvitee()`/`priceForGroup()` in `ticketing.ts` are
  pure functions that look that value up against the configured tiers; no tier assigned (or
  a value that matches no configured tier) owes **$0**, never an error, never blocking.
  Both the Invitees table and the Responses table render this field as an inline `<select>`
  when it's the linked ticketing field (not the generic read-only text every other custom
  field gets) — the dropdown's options always come from the tier list, so the two tables
  can't disagree with each other or with the Ticketing card.
- **Payments are a flexible ledger** (`ticket_payments`): one entry is tagged to exactly one
  of an invitee or a group (DB `CHECK (num_nonnulls(invitee_id, group_id) = 1)`), so a
  planner can record either "$50 from Alex" or "$150 from the Johnson family" as a single
  entry. Each carries `paid_on` (YYYY-MM-DD the money changed hands — planner-chosen, defaults
  to the planner's *local* today, backdatable, never future; distinct from `recorded_at`) and
  `method` (`cash | card | cashapp_venmo | check | other`, with a required `method_other`
  description for `other`; list + validation in `src/lib/payment-methods.ts`). Payments that
  predate these have `paid_on` backfilled from `recorded_at` and `method` NULL — editing one
  doesn't force a method onto it. Unlike `rsvp_responses`, entries are **editable in place**
  with a soft void (`voided_at`/`voided_by`), not append-only — a planner fixing a mis-entered
  amount is the common case here, not a rare correction.
- **Donations/tips and refunds share the same ledger.** `ticket_payments.donation_cents` is the
  part of a row's `amount_cents` that belongs to the planner-named donations bucket
  (`events.donations_enabled`/`donations_label`, set on the Ticketing card): 0 for an ordinary
  payment, the overpayment for "apply the extra to donations", all of it for a direct gift.
  `kind = 'refund'` rows are money handed back, out of tickets (`donation_cents = 0`) or donations
  (`donation_cents = amount_cents`), capped at what that invitee/group has in that bucket
  (`refundableFor()`). **Every ticket sum must go through `ticketNet()`** in `ticketing.ts`
  (`±(amount_cents - donation_cents)`) — a raw `SUM(amount_cents)` would count donations as
  ticket money and refunds as payments. Voiding a payment, or editing its amount/donation portion,
  is rejected if a refund already drew on that money (void/edit the refund first). Splits divide
  only a payment's ticket portion.
- **Declined invitees owe $0 — everywhere.** `owedFor()` in `ticketing.ts` is the single rule:
  tier price, or 0 if the latest response is `declined`. Tickets tab rows, group totals, the
  summary card, the payment pickers, and the guest group link all go through it, so they always
  agree; anything a declined person already paid shows as credit (refundable).
- **Group payments are applied only to members with an amount due** (`distributeGroupPayment` in
  `src/lib/group-payment-share.ts`, pure + exact to the cent): in proportion to what each still owes
  until everyone's covered, then any extra in proportion to ticket price. A member who owes nothing
  (declined, no ticket type, or a $0 tier) never receives any — and if nobody in the group owes
  anything, nothing is attributed to individuals; it only shows on the group row.
- **Donations note for guests** (optional): `events.donations_message_enabled` + `donations_message`
  (NULL/blank = default text), set under the Ticketing card's donations section. `donationNoteFor()`
  in `src/lib/donation-note.ts` is the single on/off rule — shown only while ticketing, donations, and
  the message are all on — and both guest APIs (`/api/rsvp/[token]`, `/api/g/[token]`) return its
  result as `donationNote`, rendered by `DonationNote` under the event details.
- **Tickets summary card** (`TicketsSummaryCard`, from `getTicketingSummary().totals`): Expected
  is the sum of everyone's `owedFor`; Outstanding/Credits are per *party* (a group as one unit, an
  ungrouped invitee as another), so one family's credit never hides another's balance. Donations
  are their own tile, linking to `GET .../donations` (`listDonations`). Collected links to
  `GET .../collected` (`listCollected` — must use the same filters as the Collected sum: ticket
  portion only, active invitees + existing groups, same clone scoping, or the list stops adding up);
  Outstanding's list is built client-side from the summary's groups + ungrouped invitees, the same
  parties the card sums.
- **RSVP status for filtering comes from the latest response.** `listInvitees` returns
  `COALESCE(latest rsvp_status, invitations.status)` and one (earliest) invitation per invitee; the
  Invitees, Responses, and Tickets filters all key off that same source, never
  `invitations.status` alone. Group views show a group when any member matches. Changing a
  filter clears the current selection, so a bulk action can never hit hidden rows.
- **Group payments can be custom-split** (`ticket_payment_allocations`): portions credited to
  specific current members instead of the automatic rule above — but never to a member who owes
  nothing (the split route refuses it; a split portion on someone who has since declined falls
  back into the automatic pool). The payment's own amount/group tag never
  change, so the group total doesn't either — only the per-member breakdown does. On the
  Tickets tab, a member's Paid = their own payments + their allocations + their automatic share of
  whatever's left unallocated; an allocation to someone no longer an active member (or who now
  owes nothing) falls back into that pool, so members' shares sum to the group total whenever
  anyone in the group owes something. An edit can't lower a payment below its allocated total (the `PATCH` returns a 400).
  The Responses tab's per-invitee Paid column still shows only payments tagged directly to them.
- **Tickets tab UI**: a "Receive payment" button (pick an invitee or group first) plus a ⋮
  `KebabMenu` per row — Edit (`EditPaymentsModal`: edit/void/split), Receive payment, Change
  ticket type (`ChangeTicketTypeModal` → `PATCH .../ticketing/assignments`, assembly-scoped
  like payments, only configured tier names accepted). `KebabMenu` positions its panel
  `fixed` and *follows* its button on scroll rather than closing — the table scrolls sideways
  on phones, and closing on any scroll made the menu unusable there.
- Every payment operation (`POST`/`GET .../payments`, `PATCH`/`DELETE .../payments/[paymentId]`,
  `PUT .../payments/[paymentId]/allocations`) is `requireAssemblyScope`-gated, viewers fully
  blocked, and every write re-derives the target invitee/group from the *payment's own* stored
  row (not the request body) before checking `canManageInvitee`/`canManageGroup` — so a
  lead/co-planner can't spoof scope by naming a payment ID that belongs to someone else's clone.

### Schema changes (read before editing schema.sql)

`ensureSchema()` in `db.ts` runs the entire `schema.sql` as one implicit transaction, and
caches the promise per process. Two distinct production incidents have come from this:

1. **Statement ordering** (commit `db699dc`): on a database where a table already exists,
   its `CREATE TABLE IF NOT EXISTS` block is a no-op, so any `ALTER TABLE ADD COLUMN` for
   that table must appear **before** any statement (index, FK, etc.) that references the
   new column — even though within a fresh `CREATE TABLE` block the column is already
   defined at that point.
2. **Concurrent execution across serverless instances** (commit `1c2c208`): "once per
   process" doesn't mean "once overall" on Vercel — a deploy or traffic burst spins up many
   independent instances at once, each racing to run this same multi-statement DDL script
   against the same database. Two such transactions touching overlapping tables in
   different orders deadlocked Postgres outright in production. Fixed with a session-held
   `pg_advisory_lock` around the whole schema application (only one instance applies it at
   a time; everyone else waits briefly and finds it already done), plus no longer caching a
   *rejected* promise forever — a failed attempt now lets the next call retry from scratch
   instead of leaving that process permanently broken until it recycles.
3. **Orphaned advisory lock, no timeout anywhere** (2026-09-28): the fix for #2 above assumed
   the lock holder always releases it, but never accounted for one dying mid-hold (a Vercel
   function killed at its max duration, a dropped connection during a Neon compute
   wake-from-suspend, etc.). `getPool()`'s `Pool` had no `connectionTimeoutMillis`,
   `statement_timeout`, or `lock_timeout` set anywhere, so every other instance's
   `pg_advisory_lock` call — and this runs before *every* query, via `ensureSchema()` — just
   blocked forever waiting on a lock nothing would ever release, hanging the entire site
   until Vercel force-killed each request at 300s. Recurred repeatedly (worse right after a
   deploy, since that recycles every instance at once) until diagnosed. Fixed by giving the
   pool real timeouts (`lock_timeout`, `statement_timeout`, `connectionTimeoutMillis`,
   `idle_in_transaction_session_timeout`, all in the 10-20s range) — a stuck lock now fails
   fast and the existing retry-on-next-call logic from incident #2 takes it from there, so
   the whole site self-heals within seconds instead of needing someone to manually kill the
   stuck backend in Neon.
4. **Silently dead pooled connection, server-side timeouts don't cover it** (2026-09-29): #3's
   timeouts are all enforced by Postgres itself, so they only apply once a query actually
   reaches the server. Recurred the very next day — DevTools Network showed
   invitees/assemblies/ticketing requests still pending after 5+ minutes, far past those 10-20s
   settings — because a pooled connection had gone silently dead (no clean close, just a black
   hole between Vercel and Neon) and the query sent over it never reached Postgres to be timed
   out at all. Fixed by adding `query_timeout` (enforced client-side by `pg` itself, regardless
   of the server) plus `keepAlive`/`keepAliveInitialDelayMillis` so a dead connection is more
   likely to be caught and evicted by the OS before it's ever handed back out of the pool.
5. **Dead connections were still being handed out, just failing faster** (2026-10-01): after #4,
   Vercel logs showed `Query read timeout` 500s on some of a page's parallel requests while
   siblings fired at the same instant succeeded — some pooled connections dead, others fine.
   Root cause: Vercel suspends an instance between requests, Neon's proxy drops its idle
   connections meanwhile, and the pool's idle-reaping timer can't run while suspended, so the
   next request gets a stale connection. Fixed at the source with `attachDatabasePool(pool)`
   from `@vercel/functions` + a short `idleTimeoutMillis` (keeps the instance alive until idle
   connections are closed cleanly before it suspends), plus a safety net in `db.ts`: a
   **read-only** (`SELECT`/`WITH`) query that fails with a connection-level error is retried
   once on a fresh connection (writes never are — a timed-out write may have applied), and
   `ensureSchema` now destroys a failed client (`release(err)`) instead of returning it to the
   pool. The client side also needed fixing: `InviteesManager`'s `load()` called `res.json()`
   on the failed 500's empty body, threw, and never reached `setLoading(false)`, so the tab sat
   on "Loading invitees…" forever — see the `res.json()` gotcha below.

**Attempted and reverted**: setting `idle_session_timeout` via the raw `options: "-c
idle_session_timeout=..."` startup-parameter escape hatch (this `pg` version has no first-class
typed option for it) to have Postgres reap orphaned-idle connections server-side. Worked and
verified against local Postgres, but broke production outright once deployed — every request
started failing fast with a server-side exception instead of hanging, strongly suggesting Neon's
connection (likely pooled, PgBouncer-based) rejects or mishandles that raw options mechanism even
though the GUC itself is standard Postgres 14+. Reverted (commit `b6d3b37`). If this is worth
retrying, verify against Neon specifically (not just local Postgres) before deploying, and prefer
`SET idle_session_timeout = ...` run once per connection via the pool's `connect` event over the
`options` string, since that goes through the same regular query path every other query already
uses successfully rather than a startup parameter.

Consequences for editing `schema.sql`:

- New tables use `CREATE TABLE IF NOT EXISTS`; new columns on existing tables use
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Every statement must be idempotent — this file
  reruns in full on every deploy, from every instance.
- Before committing a schema change, verify it applies cleanly against a database that
  already has the *previous* schema applied (not just a fresh one), that re-running it a
  second time is a no-op, **and** that running it from several concurrent connections at
  once against a fresh database doesn't error (this last one caught incident #2 above —
  a quick way to check: fire `Promise.allSettled` over several separate `pg.Pool`s each
  running the full schema.sql against the same throwaway database).

## Known gotchas

- **`invitees.last_name` is `NOT NULL`, but events using "single full name" format
  legitimately store `last_name = ""`** (the whole name goes in `first_name`; see
  `fullName()` in `utils.ts`). Any code that writes `last_name` must pass that empty string
  through untouched — never `value || null`, which silently violates the constraint on
  every edit to one of these invitees regardless of what was actually being changed.
  `createInvitee` always did this correctly; the invitee `PATCH` route didn't until this
  was caught in production.
- **A text column holding "malformed" JSON (e.g. the literal string `"null"` instead of a
  real SQL `NULL`) will crash naive `JSON.parse(...)` + `Object.keys(...)` chains.** This
  hit `invitees.custom_fields` in production (crashed the invitee `PATCH` route with an
  empty 500 response). The fix pattern used in `AddInviteeModal.tsx`
  (`parseCustomFields()`) and the `PATCH` route: never trust `JSON.parse` to return a plain
  object — check `typeof x === "object" && !Array.isArray(x)` before doing anything
  object-shaped with it.
- **Always guard `res.json()` on the client after a fetch that might 500.** A server crash
  returns a non-JSON (often empty) body; calling `res.json()` unconditionally throws an
  *uncaught* exception in that case, which silently aborts the handler with zero user
  feedback — no error shown, nothing saved, no clue why. Wrap it: `let data = {}; try { data
  = await res.json(); } catch {}` before checking `res.ok`.
- **Removing an invitee is a soft delete** (`invitees.active = 0` via `deactivateInvitee` —
  their `invitations`/`rsvp_responses` rows are never actually deleted). Any *new* aggregate
  query that joins back to `invitations`/`rsvp_responses` without also joining `invitees` and
  filtering `active = 1` will keep counting removed people forever — this hit
  `getEventStats` in production (the event-header "N Invited" numbers never went down after
  a bulk removal) even though the assembly-scoped equivalent, `getAssemblyStats`, already had
  the filter. `listInvitees`, `listInviteeResponseRows`, `listResponsesForEvent`, and
  `questionReport` all filter on this correctly today — copy one of those, not a query that
  predates this fix.

## Environment note

`.env.example` still describes an older SQLite (`DATABASE_FILE`) setup; the app now runs on
Postgres exclusively (`DATABASE_URL`, required — see `src/lib/db.ts`). Prefer the README's
env var guidance over `.env.example` if they conflict.
