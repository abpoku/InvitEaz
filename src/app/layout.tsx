import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "InvitEaz — invite with ease",
  description:
    "The simplest way to manage your event guest list and RSVPs. Personalized invitations, real-time headcount, and effortless attendee communication.",
};

// viewportFit "cover" lets pinned bars reach the screen edge on notched phones; pad them with
// env(safe-area-inset-*) so their content stays clear of the notch and home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF7F0",
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
