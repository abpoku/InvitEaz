export function EnvelopeMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="42" height="30" rx="3" className="fill-white stroke-wine-500" strokeWidth="1.5" />
      <path d="M2.5 3 L22 19 L41.5 3" className="stroke-wine-500" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="17" r="4.2" className="fill-brass-400" />
    </svg>
  );
}
