-- InvitEaz database schema (PostgreSQL).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  organization TEXT,
  country TEXT,
  plan TEXT NOT NULL DEFAULT 'FREE', -- FREE | PRO | BUSINESS
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,        -- ISO date, e.g. 2026-10-24
  event_time TEXT NOT NULL,        -- HH:MM
  end_time TEXT,
  location_type TEXT NOT NULL DEFAULT 'physical', -- physical | virtual | hybrid
  venue_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  meeting_url TEXT,
  meeting_instructions TEXT,
  image_url TEXT,
  organizer_name TEXT,
  organizer_contact TEXT,
  website TEXT,
  dress_code TEXT,
  instructions TEXT,
  rsvp_deadline TEXT,              -- ISO datetime
  rsvp_deadline_is_custom INTEGER NOT NULL DEFAULT 0,
  rsvp_reopened INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | rsvp_closed | completed | cancelled
  visibility TEXT NOT NULL DEFAULT 'invite_only', -- invite_only | public | hybrid
  group_rsvp_mode TEXT NOT NULL DEFAULT 'primary_contact', -- group | individual | primary_contact
  default_plus_one_policy TEXT NOT NULL DEFAULT 'none', -- none | one | multiple
  cancellation_message TEXT,
  theme TEXT NOT NULL DEFAULT 'classic',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);

-- Assemblies partition a single event's guest list into distinct groups (e.g. multiple
-- congregations/branches attending one event), each with its own scoped "lead planner".
CREATE TABLE IF NOT EXISTS assemblies (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_assemblies_event ON assemblies(event_id);

CREATE TABLE IF NOT EXISTS event_members (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer', -- owner | admin | viewer | lead_planner | co_planner
  assembly_id TEXT REFERENCES assemblies(id) ON DELETE CASCADE, -- set for lead_planner/co_planner: scopes their access to one assembly
  status TEXT NOT NULL DEFAULT 'active', -- pending | active
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_members_event ON event_members(event_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON event_members(user_id);
ALTER TABLE event_members ADD COLUMN IF NOT EXISTS assembly_id TEXT REFERENCES assemblies(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leader_invitee_id TEXT,
  assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_groups_event ON groups(event_id);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL;
-- Group RSVP link (/g/[token]): one non-guessable token per household. A volatile DEFAULT is
-- evaluated per row, so this ADD COLUMN backfills every existing group with its own distinct token
-- and every future INSERT gets one automatically — no application code has to remember to set it.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS rsvp_token TEXT DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_rsvp_token ON groups(rsvp_token);

CREATE TABLE IF NOT EXISTS invitees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_adult INTEGER NOT NULL DEFAULT 1,
  plus_one_policy TEXT,  -- overrides event default when set: none | one | multiple
  notes TEXT,
  custom_fields TEXT,     -- JSON object of {fieldKey: value} for planner-defined custom invitee fields
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_invitees_event ON invitees(event_id);
CREATE INDEX IF NOT EXISTS idx_invitees_group ON invitees(group_id);
-- Additive migrations for columns introduced after the initial CREATE TABLE (safe to re-run).
-- These must run BEFORE anything below that indexes/references the new columns, since on an
-- already-existing table the CREATE TABLE above is a no-op and never adds them.
ALTER TABLE invitees ADD COLUMN IF NOT EXISTS custom_fields TEXT;
ALTER TABLE invitees ADD COLUMN IF NOT EXISTS assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS invitee_name_format TEXT NOT NULL DEFAULT 'first_last'; -- first_last | full
-- Set when a guest adds someone to their own household from the group RSVP link (counts against
-- the event's guest allowance; planner-added invitees never do).
ALTER TABLE invitees ADD COLUMN IF NOT EXISTS added_by_guest INTEGER NOT NULL DEFAULT 0;
-- Explicit additional-guest allowance, replacing default_plus_one_policy's vague 'multiple'
-- (see src/lib/guest-allowance.ts). NULL = never set; backfilled once from the legacy policy below,
-- and the WHERE makes that backfill a no-op on every later run. default_plus_one_policy is still
-- kept in sync on every write so nothing that reads it directly needs to change.
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_allowance_mode TEXT;   -- none | per_person | per_group
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_allowance_count INTEGER; -- additional guests allowed (per person or per group)
UPDATE events SET
  guest_allowance_mode = CASE default_plus_one_policy WHEN 'none' THEN 'none' ELSE 'per_person' END,
  guest_allowance_count = CASE default_plus_one_policy WHEN 'one' THEN 1 WHEN 'multiple' THEN 7 ELSE 0 END
WHERE guest_allowance_mode IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitees_assembly ON invitees(assembly_id);

CREATE TABLE IF NOT EXISTS invitee_fields (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,      -- stable identifier: 'email' | 'phone' | 'group' | 'is_adult' | 'plus_one_policy' | 'notes' | custom slug
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',       -- core | custom
  field_type TEXT NOT NULL DEFAULT 'text',   -- text | email | phone | number | date | dropdown | checkbox
  options_json TEXT,      -- JSON array of strings for dropdown fields
  required INTEGER NOT NULL DEFAULT 0,
  collect_at_signup INTEGER NOT NULL DEFAULT 1, -- shown on the public self-signup form
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,  -- soft-disable: hidden from new forms, historical values kept
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_invitee_fields_event ON invitee_fields(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitee_fields_event_key ON invitee_fields(event_id, key);

-- Ticketed events: a planner links ticketing to one existing custom dropdown invitee field (see
-- ticket_tiers below, appended at the end of this file) rather than defining a separate tier
-- list — the field itself needs no schema change to support this. Placed here, not with the
-- other events ALTERs further down, because ticket_field_id references invitee_fields, which
-- must already exist.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticketing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_field_id TEXT REFERENCES invitee_fields(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invitee_id TEXT REFERENCES invitees(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  is_public_signup INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'invited', -- invited|delivered|opened|attending|declined|maybe|no_response|rsvp_locked
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_invitations_event ON invitations(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);

CREATE TABLE IF NOT EXISTS rsvp_questions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL, -- short_text|long_text|single_choice|multiple_choice|dropdown|yes_no|number|date|time|email|phone|checkbox
  options_json TEXT,  -- JSON array of strings for choice types
  required INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  show_if_attending TEXT, -- 'yes' | 'no' | NULL (always)
  kind TEXT NOT NULL DEFAULT 'custom', -- core | custom
  key TEXT,      -- stable identifier for core rows: 'attending' | 'email' | 'phone' | 'guest_count'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_questions_event ON rsvp_questions(event_id);
-- Additive migrations for columns introduced after the initial CREATE TABLE (safe to re-run).
-- These must run BEFORE anything below that indexes/references the new columns, since on an
-- already-existing table the CREATE TABLE above is a no-op and never adds them.
ALTER TABLE rsvp_questions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE rsvp_questions ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE rsvp_questions ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_event_key ON rsvp_questions(event_id, key) WHERE key IS NOT NULL;

CREATE TABLE IF NOT EXISTS rsvp_responses (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attending INTEGER NOT NULL, -- 1 = yes, 0 = no
  num_attending INTEGER NOT NULL DEFAULT 1,
  guest_names_json TEXT,
  responder_name TEXT,
  responder_email TEXT,
  responder_phone TEXT,
  is_modification INTEGER NOT NULL DEFAULT 0,
  reopened_after_deadline INTEGER NOT NULL DEFAULT 0,
  responded_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_responses_invitation ON rsvp_responses(invitation_id);
CREATE INDEX IF NOT EXISTS idx_responses_event ON rsvp_responses(event_id);

-- Additive migration for tri-state RSVP status ("maybe") + manual-entry audit trail. rsvp_status
-- becomes the source of truth for attending/declined/maybe going forward; the legacy `attending`
-- column is left untouched and still populated on every insert (1 for 'attending', 0 for
-- 'declined' or 'maybe') so every existing reader of that raw column keeps working unmodified.
ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS rsvp_status TEXT; -- 'attending' | 'declined' | 'maybe'
ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS recorded_by TEXT; -- planner's email if manually recorded; NULL = guest self-submission

-- Backfill existing rows exactly once. Guarded by `WHERE rsvp_status IS NULL` so re-running this
-- script (it reruns in full on every boot) is a true no-op once every row has a value — every
-- INSERT path that writes rsvp_responses always sets rsvp_status explicitly, so a NULL only ever
-- means "predates this migration." This can never stomp a real 'maybe' back down to 'declined'.
UPDATE rsvp_responses
SET rsvp_status = CASE WHEN attending = 1 THEN 'attending' ELSE 'declined' END
WHERE rsvp_status IS NULL;

CREATE TABLE IF NOT EXISTS rsvp_answers (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES rsvp_responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES rsvp_questions(id) ON DELETE CASCADE,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_answers_response ON rsvp_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON rsvp_answers(question_id);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL, -- set when sent by/scoped to one assembly
  type TEXT NOT NULL, -- invitation|reminder|event_update|confirmation|final_reminder|cancellation|custom
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipients_filter TEXT NOT NULL DEFAULT 'everyone',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_comms_event ON communications(event_id);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS assembly_id TEXT REFERENCES assemblies(id) ON DELETE SET NULL;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email'; -- email | sms

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_id);

-- One price per dropdown-option string on the field linked via events.ticket_field_id.
-- option_value is the literal option text (must match invitees.custom_fields[field.key]
-- verbatim) — not a foreign key into options_json, since that's a plain string array with no
-- per-option identity of its own. Rows are never auto-deleted when the field's options change
-- elsewhere (via the normal Fields manager) — see getTicketingConfig()'s drift computation in
-- src/lib/models/ticketing.ts — so a stale price stays visible for the planner to reconcile
-- deliberately rather than silently vanishing.
CREATE TABLE IF NOT EXISTS ticket_tiers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES invitee_fields(id) ON DELETE CASCADE,
  option_value TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_tiers_field_option ON ticket_tiers(field_id, option_value);
CREATE INDEX IF NOT EXISTS idx_ticket_tiers_event ON ticket_tiers(event_id);

-- Payment ledger for ticketed events. Exactly one of invitee_id/group_id is set per entry (a
-- lump group payment vs a payment tied to one person) — enforced with a CHECK since this is
-- money and shouldn't rely on app code alone. Entries are edit-in-place + soft-voidable
-- (voided_at/voided_by), a deliberate departure from rsvp_responses' append-only "latest wins"
-- design: a planner fixing a fat-fingered amount is the dominant real-world need here, and an
-- offsetting correction row is a worse UX for a non-accountant planner than a direct edit. Every
-- create/edit/void still calls logAudit for a plain-English trail even though the row itself is
-- mutated.
CREATE TABLE IF NOT EXISTS ticket_payments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invitee_id TEXT REFERENCES invitees(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  note TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  voided_at TEXT,
  voided_by TEXT,
  CONSTRAINT ticket_payments_one_target CHECK (num_nonnulls(invitee_id, group_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_ticket_payments_event ON ticket_payments(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_payments_invitee ON ticket_payments(invitee_id);
CREATE INDEX IF NOT EXISTS idx_ticket_payments_group ON ticket_payments(group_id);
-- When the money actually changed hands (planner-chosen, defaults to today) and how — distinct from
-- recorded_at, which is when someone typed it in. paid_on is a plain YYYY-MM-DD date (no time, no
-- zone). Backfilled once from recorded_at for payments that predate this; the WHERE makes later
-- runs a no-op.
ALTER TABLE ticket_payments ADD COLUMN IF NOT EXISTS paid_on TEXT;
ALTER TABLE ticket_payments ADD COLUMN IF NOT EXISTS method TEXT;        -- cash | card | cashapp_venmo | check | other
ALTER TABLE ticket_payments ADD COLUMN IF NOT EXISTS method_other TEXT;  -- required description when method = 'other'
UPDATE ticket_payments SET paid_on = substr(recorded_at, 1, 10) WHERE paid_on IS NULL;

-- Custom split of a group payment: portions of it credited to specific members instead of being
-- shared equally. The payment's own amount and group tag never change, so the group's total is
-- unaffected; only the per-member breakdown is. Whatever isn't allocated (or is allocated to someone
-- no longer an active member of that group) is still shared equally — see getTicketingSummary.
CREATE TABLE IF NOT EXISTS ticket_payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES ticket_payments(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES invitees(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_allocations_unique ON ticket_payment_allocations(payment_id, invitee_id);
