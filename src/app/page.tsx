import Link from "next/link";
import { EnvelopeMark } from "@/components/EnvelopeMark";
import { HeroInvite } from "@/components/HeroInvite";

const problems = [
  { from: "Spreadsheets", issue: "no idea who's actually responded" },
  { from: "Group texts", issue: "replies get buried in three different threads" },
  { from: "Paper invites", issue: "no way to reach anyone if the venue changes" },
  { from: "Email chains", issue: "headcount is a manual, error-prone recount" },
];

const features = [
  {
    title: "Group-aware RSVP",
    body: "Households respond together or separately — your call. The Johnson family answers once; a conference RSVPs one badge at a time.",
  },
  {
    title: "A form builder that doesn't feel technical",
    body: "Meal choice, transportation, t-shirt size — add the questions your event actually needs, with no code and no clutter.",
  },
  {
    title: "Headcount that updates itself",
    body: "Every yes, no, and change of mind lands on your dashboard the instant it happens. No manual recount, ever.",
  },
  {
    title: "One thread per guest",
    body: "Invitations, reminders, and updates for one wedding, gala, or town hall — all in a single place instead of scattered apps.",
  },
];

const steps = [
  { title: "Build the event", body: "Name, date, location, and the questions you want answered." },
  { title: "Bring your list", body: "Type guests in by hand or drop in a spreadsheet — households included." },
  { title: "Share the link", body: "Each guest gets a personal RSVP page. No account, no app, no friction." },
  { title: "Watch it fill in", body: "Responses, headcount, and meal counts update live as replies land." },
];

const plans = [
  {
    name: "Free",
    price: "$0",
    tagline: "For your next birthday or backyard get-together.",
    items: ["2 active events", "Up to 40 invitees per event", "Personalized RSVP links", "Email invitations & reminders"],
  },
  {
    name: "Pro",
    price: "$19",
    per: "/month",
    tagline: "For planners running weddings, galas, or a full events calendar.",
    items: ["15 active events", "Up to 750 invitees per event", "Custom RSVP forms & reporting", "5 co-planner seats", "CSV/XLSX exports"],
    featured: true,
  },
  {
    name: "Business",
    price: "Talk to us",
    tagline: "For churches, schools, and organizations running recurring events.",
    items: ["Unlimited events & invitees", "Unlimited co-planners", "Priority support", "Advanced branding"],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-paper-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <EnvelopeMark className="w-7 h-5" />
            <span className="font-serif text-lg text-ink">InvitEaz</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-ink-soft">
            <a href="#how-it-works" className="hover:text-ink">How it works</a>
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link href="/login" className="btn-ghost px-3 sm:px-4">Log in</Link>
            <Link href="/register" className="btn-primary px-3 sm:px-4 whitespace-nowrap">
              <span className="sm:hidden">Sign up</span>
              <span className="hidden sm:inline">Create an event</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 pb-16 sm:pt-16 sm:pb-20 grid md:grid-cols-2 gap-10 md:gap-12 items-center">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl md:text-[2.75rem] leading-[1.1] md:leading-[1.08] text-ink max-w-md">
            Invite with ease. Know who&apos;s coming, always.
          </h1>
          <p className="mt-5 text-lg text-ink-soft max-w-md leading-relaxed">
            InvitEaz replaces the spreadsheet, the group text, and the paper invite with one
            place to manage your guest list, collect RSVPs, and get an accurate headcount —
            in real time.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <Link href="/register" className="btn-primary px-6 py-3 text-base justify-center">Start planning free</Link>
            <a href="#how-it-works" className="btn-secondary px-6 py-3 text-base justify-center">See how it works</a>
          </div>
          <p className="mt-4 text-sm text-ink-faint">No credit card. No app for your guests to download.</p>
        </div>
        <HeroInvite />
      </section>

      {/* Problem */}
      <section className="border-y border-paper-line bg-paper-soft/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <h2 className="font-serif text-2xl text-ink max-w-lg">You're probably running your guest list on four different tools right now.</h2>
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            {problems.map((p) => (
              <div key={p.from} className="card p-5 flex items-start gap-4">
                <div className="w-1.5 self-stretch rounded-full bg-clay-500/70" />
                <div>
                  <p className="font-medium text-ink">{p.from}</p>
                  <p className="text-sm text-ink-soft mt-0.5">{p.issue}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
        <h2 className="font-serif text-2xl text-ink">Four steps, one afternoon.</h2>
        <div className="mt-10 grid sm:grid-cols-2 md:grid-cols-4 gap-6">
          {steps.map((s, i) => (
            <div key={s.title} className="card p-7 flex flex-col items-start">
              <div className="w-14 h-14 rounded-full bg-wine-50 border border-wine-300 text-wine-500 flex items-center justify-center font-serif text-2xl">
                {i + 1}
              </div>
              <p className="mt-6 font-medium text-lg text-ink">{s.title}</p>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
          <h2 className="font-serif text-2xl max-w-lg">Built around what actually makes RSVPs hard.</h2>
          <div className="mt-10 grid md:grid-cols-2 gap-x-10 gap-y-10">
            {features.map((f) => (
              <div key={f.title} className="border-t border-paper/15 pt-5">
                <p className="font-serif text-lg">{f.title}</p>
                <p className="mt-2 text-paper/70 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
        <h2 className="font-serif text-2xl text-ink">One platform, every kind of gathering.</h2>
        <p className="mt-3 text-ink-soft max-w-xl">
          Weddings and birthdays. Church socials and school fundraisers. Board meetings and
          conferences. If it needs a guest list, InvitEaz can run it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {["Weddings", "Birthdays", "Corporate events", "Conferences", "Church events", "Fundraisers", "Graduation parties", "Family reunions", "Networking events", "Community events"].map((t) => (
            <span key={t} className="chip bg-white border border-paper-line text-ink-soft px-4 py-2 text-sm">{t}</span>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-paper-line bg-paper-soft/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
          <h2 className="font-serif text-2xl text-ink">Start free. Upgrade when your guest list grows.</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            {plans.map((p) => (
              <div key={p.name} className={`card p-7 flex flex-col ${p.featured ? "border-wine-300 shadow-lifted" : ""}`}>
                {p.featured && <span className="chip bg-wine-500 text-paper w-fit mb-3">Most popular</span>}
                <p className="font-serif text-xl text-ink">{p.name}</p>
                <p className="mt-2">
                  <span className="font-serif text-3xl text-ink">{p.price}</span>
                  {p.per && <span className="text-ink-faint">{p.per}</span>}
                </p>
                <p className="mt-2 text-sm text-ink-soft">{p.tagline}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-ink-soft flex-1">
                  {p.items.map((it) => (
                    <li key={it} className="flex items-start gap-2">
                      <span className="text-moss-500 mt-0.5">✓</span> {it}
                    </li>
                  ))}
                </ul>
                <Link href="/register" className={`mt-7 ${p.featured ? "btn-primary" : "btn-secondary"}`}>
                  {p.name === "Business" ? "Contact us" : "Get started"}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-ink-faint">Attendees never pay or sign up for an account to RSVP.</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-24 text-center">
        <h2 className="font-serif text-3xl text-ink max-w-xl mx-auto">Your next event deserves a guest list that keeps itself organized.</h2>
        <Link href="/register" className="btn-primary px-7 py-3.5 text-base mt-8 inline-flex">Create your first event</Link>
      </section>

      <footer className="border-t border-paper-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <EnvelopeMark className="w-6 h-4" />
            <span className="font-serif text-ink">InvitEaz</span>
          </div>
          <p className="text-sm text-ink-faint">© {new Date().getFullYear()} InvitEaz. Invite with ease.</p>
        </div>
      </footer>
    </div>
  );
}
