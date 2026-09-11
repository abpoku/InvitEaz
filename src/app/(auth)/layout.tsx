import Link from "next/link";
import { EnvelopeMark } from "@/components/EnvelopeMark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <header className="px-6 h-16 flex items-center">
        <Link href="/" className="flex items-center gap-2">
          <EnvelopeMark className="w-7 h-5" />
          <span className="font-serif text-lg text-ink">InvitEaz</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
