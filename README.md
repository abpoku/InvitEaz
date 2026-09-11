# InvitEaz — invite with ease

The simplest way to manage your event guest list and RSVPs. Built with
Next.js 14, TypeScript, and a self-contained SQLite database — clone it,
run it, deploy it.

Covers the full MVP: planner accounts, event creation, a drag-free RSVP form
builder, manual + spreadsheet (CSV/XLSX) invitee import with validation,
households/groups and plus-ones, personalized + public RSVP links, real-time
headcount, targeted email communications, automated reminders, co-planner
roles, CSV exports, and a free/paid plan structure.

## Quick start

```bash
npm install
cp .env.example .env.local   # then edit NEXTAUTH_SECRET at minimum
npm run dev
```

Open http://localhost:3000. Register a planner account and create your first
event — or run the seed script for a ready-made demo:

```bash
npm run db:seed
# then log in with demo@inviteaz.app / password123
```

The database is a single SQLite file created automatically at
`data/inviteaz.db` the first time the app runs. No separate database server
to install.

## Environment variables

See `.env.example` for the full list. The only one you must set is
`NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`). Everything else
has a sensible default:

- **Email**: if `SMTP_HOST` isn't set, outgoing emails are logged to the
  server console instead of sent — so every flow (invitations, reminders,
  confirmations, event-change notices) is fully testable with zero setup.
  Add SMTP credentials (Resend, Postmark, SES, Gmail SMTP, etc.) whenever
  you're ready to send real email.
- **Reminders**: `POST /api/cron/reminders` sends the "7 days before" and
  "24 hours before" RSVP-deadline reminders. It's not wired to a scheduler
  by default — call it once a day from GitHub Actions, Vercel Cron, or any
  uptime/cron service. Set `CRON_SECRET` and pass it as an `x-cron-secret`
  header to protect the endpoint.

## Deploying

This app needs a persistent filesystem for its SQLite file, so it's best
suited to a platform that gives you one:

- **Railway / Render / Fly.io**: connect the GitHub repo, add a persistent
  volume mounted at (for example) `/data`, set `DATABASE_FILE=/data/inviteaz.db`
  plus `NEXTAUTH_SECRET` and `NEXT_PUBLIC_APP_URL`, and deploy. Build command
  `npm run build`, start command `npm start`.
- **A VPS** (Droplet, EC2, etc.): `git clone`, `npm install`, `npm run build`,
  run with `npm start` behind a process manager (pm2, systemd) and a reverse
  proxy (Caddy/nginx) for TLS.
- **Docker**: a minimal `Dockerfile` isn't included, but this is a standard
  Next.js app — `node:20-slim`, `npm ci && npm run build`, `npm start`, with
  a volume mounted at whatever `DATABASE_FILE` points to.

**Serverless platforms (Vercel, Netlify Functions) will not work as-is** —
their filesystems are ephemeral/read-only at runtime, so a file-based SQLite
database won't persist writes. To deploy there, swap the database layer
(`src/lib/db.ts` and `src/lib/models/*.ts`) for a hosted Postgres database
(Neon, Supabase, Vercel Postgres) using `pg` or an ORM of your choice — the
SQL in `src/lib/schema.sql` is close to standard SQL and is a good starting
point for a Postgres migration (mainly: swap `TEXT` timestamp defaults for
`TIMESTAMPTZ DEFAULT now()`, and `INTEGER` booleans for real `BOOLEAN`).

## Architecture

- **Framework**: Next.js 14 (App Router), TypeScript, Tailwind CSS.
- **Database**: SQLite via `better-sqlite3`, with a hand-written schema
  (`src/lib/schema.sql`) and typed query functions in `src/lib/models/*` —
  no ORM. This was a deliberate choice for this build: Prisma's engine
  binaries are fetched from a domain that wasn't reachable in the sandbox
  this was built in, and a query layer this size is easy to audit and cheap
  to run anywhere Node runs, including a small VPS with no separate database
  process to manage.
- **Auth**: NextAuth (credentials provider) with bcrypt-hashed passwords and
  JWT sessions — no external auth service required.
- **Email**: `nodemailer` with an SMTP transport when configured, and a
  console-log fallback otherwise (see above).
- **File parsing**: `papaparse` for CSV, `xlsx` (SheetJS) for Excel uploads.

### Core data model

Four objects everything else is built around, per the product spec:

- **Event** — what's happening (date, location, RSVP deadline, visibility).
- **Invitee** — a person on the guest list, optionally part of a **Group**.
- **Invitation** — a unique, non-guessable token connecting an invitee to an
  event; this is what the personalized `/r/[token]` link is built on.
- **RSVP Response** — what they said, plus free-form **Answers** to any
  custom **Questions** you've added to the event's RSVP form.

Also included: **Communications** (a log of every email sent, and to whom),
**EventMembers** (co-planner roles: owner/admin/viewer, enforced at the API
layer), and an **AuditLog**.

### Known simplifications

Built to be genuinely functional end-to-end rather than exhaustively cover
every edge case in the product spec. A few notable simplifications, called
out so they're easy to find and extend:

- **Group RSVPs**: when an event's household mode is "group" or "primary
  contact", whichever group member opens their link first sees a checklist
  of the whole household and can RSVP for everyone. That response is
  recorded against *their* invitation; other members' invitation rows stay
  at "no response" for record-keeping even though the household is counted
  as responded in headcount totals. Good enough for real use; a more
  rigorous implementation would sync status across every member's row.
- **Payments/ticketing**: intentionally out of scope for this MVP, per the
  product brief — the data model doesn't block adding it later.
- **Reminders** run on-demand (see above) rather than a built-in scheduler,
  since this app doesn't run its own background worker process.
- **SMS/WhatsApp**: the `communications` table and UI are structured to add
  another channel later; only email ships in this build.

## Project structure

```
src/
  app/                     Next.js App Router pages & API routes
    (auth)/login|register
    dashboard/              planner app (event CRUD, invitees, form builder,
                             responses, messages, reports, settings)
    r/[token]/               personalized attendee RSVP page
    e/[slug]/                 public/open RSVP page
    api/                      all backend routes
  components/                shared + feature UI components
  lib/
    db.ts                     SQLite connection
    schema.sql                 full database schema
    models/                     typed query functions per entity
    auth.ts, session.ts          NextAuth config + permission helpers
    email.ts, notify.ts           SMTP sending + email templates
    csv-import.ts                spreadsheet parsing & validation
scripts/seed.ts                optional demo data
```

## License

MIT — see `LICENSE`.
