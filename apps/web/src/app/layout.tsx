import type { Metadata } from "next";
import { Archivo, Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

// Expanded poster grotesk for headlines, an editorial italic serif for names, a quiet sans for UI, mono for numbers
const display = Archivo({ subsets: ["latin"], variable: "--font-display-face", axes: ["wdth"], weight: "variable" });
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif-face", weight: "400", style: ["normal", "italic"] });
const sans = Geist({ subsets: ["latin"], variable: "--font-sans-face" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Marquee — know which brands your crowd already loves",
  description: "Sponsor discovery for events, powered by Qloo's taste graph. Tell us about your event; Marquee tells you which brands to approach and why.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
