export function HeroInvite() {
  return (
    <div className="relative mx-auto w-full max-w-sm select-none" aria-hidden="true">
      {/* envelope body */}
      <div className="relative rounded-lg border border-wine-200 bg-wine-50/60 pt-16 pb-6 px-6 overflow-hidden shadow-lifted">
        {/* envelope flap */}
        <div
          className="absolute inset-x-0 top-0 h-24 origin-top bg-wine-100 border-b border-wine-200"
          style={{ clipPath: "polygon(0 0, 100% 0, 50% 62%)" }}
        />
        {/* sliding card */}
        <div className="relative z-10 animate-rise rounded-md bg-white border border-paper-line shadow-card p-5">
          <p className="text-xs tracking-wide text-ink-faint">Annual Community Gala</p>
          <h3 className="mt-1 font-serif text-xl text-ink">You&apos;re invited, Maria.</h3>
          <p className="mt-2 text-sm text-ink-soft">October 24 · 6:00 PM · Boston, MA</p>
          <div className="mt-4 flex items-center gap-2">
            <span className="chip bg-moss-50 text-moss-600">Attending</span>
            <span className="text-sm text-ink-faint">2 guests</span>
          </div>
          <div className="mt-4 h-px bg-paper-line" />
          <div className="mt-4 flex items-center justify-between text-xs text-ink-faint">
            <span>Responded 2 minutes ago</span>
            <span className="font-medium text-wine-500">RSVP #438</span>
          </div>
        </div>
      </div>
      {/* floating headcount pill */}
      <div className="absolute -right-4 -bottom-4 rounded-lg bg-ink text-paper px-4 py-3 shadow-lifted animate-rise" style={{ animationDelay: "180ms" }}>
        <p className="text-[0.7rem] text-paper/60">Live headcount</p>
        <p className="font-serif text-2xl leading-none mt-0.5">380<span className="text-paper/50 text-base"> / 500</span></p>
      </div>
    </div>
  );
}
