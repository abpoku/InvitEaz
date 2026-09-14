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
  role TEXT NOT NULL DEFAULT 'viewer', -- owner | admin | viewer | lead_planner
  assembly_id TEXT REFERENCES assemblies(id) ON DELETE CASCADE, -- set only for lead_planner: scopes their access to one assembly
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

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invitee_id TEXT REFERENCES invitees(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  is_public_signup INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'invited', -- invited|delivered|opened|attending|declined|no_response|rsvp_locked
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
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_questions_event ON rsvp_questions(event_id);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_id);
