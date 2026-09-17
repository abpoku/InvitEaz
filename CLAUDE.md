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

## Architecture

Next.js 14 App Router + TypeScript + Tailwind. No ORM: `src/lib/db.ts` wraps a `pg` Pool,
and `src/lib/models/*.ts` hold hand-written SQL per entity (events, invitees, rsvp,
assemblies, comms, users, invitee-fields). Model queries are written with `?` placeholders
(a holdover from an earlier SQLite version) — `query()`/`exec()` in `db.ts` rewrite them to
Postgres's `$1, $2…` at call time; keep using `?` in new queries rather than mixing styles.
Timestamps are plain ISO-8601 `TEXT`, not native `Date`/`timestamptz`, so every value is
predictable across drivers/environments — don't switch a column to a Postgres date type
without updating every reader.

Auth is NextAuth credentials-provider with bcrypt + JWT sessions (`src/lib/auth.ts`), no
external auth service.

### Permission model

Two independent gates in `src/lib/session.ts`, both keyed off `getMembership()` in
`models/events.ts`:

- `requireEventRole(eventId, minRole)` — ranks `viewer(0) < admin(1) < owner(2)` for
  full-event actions (settings, RSVP form, invitee-field config, co-planners,
  publish/delete). `lead_planner` has no rank and always fails this check by design.
- `requireAssemblyScope(eventId)` — for assembly-scoped actions (invitees, groups,
  messages, responses/reports). Full-event roles get `assemblyId: null` (unrestricted);
  a `lead_planner` is confined to the one assembly their `event_members` row names.

A `lead_planner` is a scoped co-planner role introduced by "Master Planner" — it manages
one assembly's slice of the guest list, not the whole event. Any new API route touching
invitees/groups/messages/reports should call `requireAssemblyScope` and filter by the
returned `assemblyId` when non-null; routes touching event-wide config should call
`requireEventRole`.

### Core data model

- **Event** → optionally split into **Assemblies** (e.g. multiple congregations/branches
  attending one event), each with its own scoped `lead_planner`.
- **Invitee** — a guest, optionally in a **Group** (for household/plus-one handling) and
  optionally tagged to an **Assembly**. Planner-defined custom fields live in
  `invitees.custom_fields` (JSON) with definitions in `invitee_fields`; matching
  uploaded-spreadsheet columns to these fields is handled by
  `src/lib/invitee-field-matching.ts`.
- **Invitation** — a unique non-guessable `token` connecting an invitee to an event; the
  personalized RSVP page is `/r/[token]`. Public/open events also allow self-signup via
  `/e/[slug]`.
- **RSVP Response** + free-form **Answers** to planner-defined **Questions**
  (`rsvp_questions`), shown/hidden per-question via `show_if_attending`.
- **Communications** — a log of every email sent (type + recipients + body), scopable to
  one assembly. **EventMembers** carries co-planner roles. **AuditLog** records actions.

**Group RSVP simplification** (intentional, not a bug): when `group_rsvp_mode` is `group`
or `primary_contact`, whichever group member opens their link first can RSVP for the whole
household; that response is recorded against *their* invitation only — other members'
invitation rows stay `no_response` even though the household counts as responded in
headcount totals.

### Schema changes (read before editing schema.sql)

`ensureSchema()` in `db.ts` runs the entire `schema.sql` as one implicit transaction, once
per process, and caches the promise — if any statement fails, that rejection is cached and
**every subsequent query in that process fails**, including login (this caused a production
outage — see commit `db699dc`). Consequences for editing `schema.sql`:

- New tables use `CREATE TABLE IF NOT EXISTS`; new columns on existing tables use
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Every statement must be idempotent — this file
  reruns in full on every deploy.
- Ordering matters: on a database where the table already exists, its `CREATE TABLE IF NOT
  EXISTS` block is a no-op, so any `ALTER TABLE ADD COLUMN` for that table must appear
  **before** any statement (index, FK, etc.) that references the new column — even though
  within a fresh `CREATE TABLE` block the column is already defined at that point.
- Before committing a schema change, verify it applies cleanly against a database that
  already has the *previous* schema applied (not just a fresh one), and that re-running it
  a second time is a no-op.

## Environment note

`.env.example` still describes an older SQLite (`DATABASE_FILE`) setup; the app now runs on
Postgres exclusively (`DATABASE_URL`, required — see `src/lib/db.ts`). Prefer the README's
env var guidance over `.env.example` if they conflict.
