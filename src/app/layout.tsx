import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "InvitEaz — invite with ease",
  description:
    "The simplest way to manage your event guest list and RSVPs. Personalized invitations, real-time headcount, and effortless attendee communication.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
