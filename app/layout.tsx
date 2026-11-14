import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jasper Plumbing House — Get a price and book a plumber",
  description:
    "Tell us what needs fixing and your distance from us. See an estimate, then request a time. We'll confirm by email.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-ink">
        {children}
        <Script
          src="https://agentplace.io/admin/embed/v1.js"
          data-agent-url="https://bobmetsnbddq.run.agentplace.io/"
          data-controls="input"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}