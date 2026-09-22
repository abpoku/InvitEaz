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
assemblies, comms, users, invitee-fields). Model queries are written with `?` placeholders
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
  (`rsvp_questions`), shown/hidden per-question via `show_if_attending`.
- **Communications** — a log of every email sent (type + recipients + body), scopable to
  one clone. **EventMembers** carries every role above. **AuditLog** records actions.

**Group RSVP simplification** (intentional, not a bug): when `group_rsvp_mode` is `group`
or `primary_contact`, whichever group member opens their link first can RSVP for the whole
household; that response is recorded against *their* invitation only — other members'
invitation rows stay `no_response` even though the household counts as responded in
headcount totals. Relatedly, `groups.leader_invitee_id` (settable via the template's
"Group Leader" column) is currently write-only — nothing reads it. It doesn't change who
sees the household checklist or anything else yet.

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

## Environment note

`.env.example` still describes an older SQLite (`DATABASE_FILE`) setup; the app now runs on
Postgres exclusively (`DATABASE_URL`, required — see `src/lib/db.ts`). Prefer the README's
env var guidance over `.env.example` if they conflict.
