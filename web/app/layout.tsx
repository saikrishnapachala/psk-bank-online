import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PSK Bank Online (demo)",
  description: "Demo online banking app: Next.js BFF, Java service, Fiserv Banking Hub and Plaid.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
