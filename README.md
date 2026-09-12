# InvitEaz — invite with ease

The simplest way to manage your event guest list and RSVPs. Built with
Next.js 14, TypeScript, and Postgres — deploys cleanly to Vercel (or any
Node host) with a free managed database.

Covers the full MVP: planner accounts, event creation, a drag-free RSVP form
builder, manual + spreadsheet (CSV/XLSX) invitee import with validation,
households/groups and plus-ones, personalized + public RSVP links, real-time
headcount, targeted email communications, automated reminders, co-planner
roles, CSV exports, and a free/paid plan structure.

## Quick start

1. Get a Postgres database. Easiest free option: [neon.tech](https://neon.tech) —
   create a project and copy its connection string. (Or run Postgres locally
   if you prefer.)
2. ```bash
   npm install
   cp .env.example .env.local
   # edit .env.local: set NEXTAUTH_SECRET and DATABASE_URL
   npm run dev
   ```

The schema (`src/lib/schema.sql`) is created automatically against your
database the first time the app runs — no separate migration step.

Open http://localhost:3000. Register a planner account and create your first
event — or run the seed script for a ready-made demo:

```bash
npm run db:seed
# then log in with demo@inviteaz.app / password123
```

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

**Vercel + Neon (recommended, free):**

1. Push this repo to GitHub and import it into Vercel.
2. In the Vercel dashboard, go to **Storage** → **Marketplace** → install
   **Neon** (Postgres). This provisions a free database and injects
   `DATABASE_URL` into your project automatically.
3. Add `NEXTAUTH_SECRET` and `NEXT_PUBLIC_APP_URL` (your Vercel deployment
   URL) as environment variables.
4. Deploy. The schema initializes itself on first request.

Any other Node host works too (Railway, Render, Fly, a VPS) — just set
`DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXT_PUBLIC_APP_URL`, run
`npm run build`, then `npm start`.

## Architecture

- **Framework**: Next.js 14 (App Router), TypeScript, Tailwind CSS.
- **Database**: Postgres via `pg` (node-postgres), with a hand-written
  schema (`src/lib/schema.sql`) and typed async query functions in
  `src/lib/models/*` — no ORM. Timestamp columns are plain `TEXT` holding
  ISO-8601 strings written by the application (rather than relying on
  driver-specific `Date` handling), which keeps every value predictable
  across environments.
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
    db.ts                     Postgres connection pool + query helpers
    schema.sql                 full database schema
    models/                     typed query functions per entity
    auth.ts, session.ts          NextAuth config + permission helpers
    email.ts, notify.ts           SMTP sending + email templates
    csv-import.ts                spreadsheet parsing & validation
scripts/seed.ts                optional demo data
```

## License

MIT — see `LICENSE`.
