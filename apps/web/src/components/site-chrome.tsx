"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

export function SiteHeader() {
  const path = usePathname();
  if (path?.endsWith("/report")) return null;
  const nav = [
    { href: "/portfolio", label: "Portfolio" },
    { href: "/demo", label: "Demo guide" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/80 backdrop-blur-md no-print">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Marquee home">
          <MarqueeMark />
          <span className="font-display text-[17px] tracking-[0.04em]">Marquee</span>
          <span className="hidden rounded-full border border-rule px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate sm:inline">for promoters</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-full px-3 py-1.5 transition-colors", path?.startsWith(n.href) ? "bg-paper-3 text-ink" : "text-slate hover:text-ink")}>
              {n.label}
            </Link>
          ))}
          <Link href="/events/new" className="ml-2 rounded-full bg-bulb px-4 py-1.5 font-medium text-[#0c0c0d] transition-colors hover:bg-ink">
            Add your event
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Logo: a single split-flap tile showing an M, with an orange "lit" dot. */
export function MarqueeMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <rect x="1" y="1" width="24" height="24" rx="5" fill="#232326" stroke="rgba(238,233,224,.18)" />
      <rect x="1.5" y="13" width="23" height="11.5" rx="4" fill="#1b1b1e" />
      <line x1="1" y1="13" x2="25" y2="13" stroke="#000" strokeWidth="1" />
      <path d="M7 18.5V7.5l3 6 3-6 3 6 3-6v11" stroke="#EEE9E0" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="21.5" cy="4.5" r="2.2" fill="#FF5A1F" />
    </svg>
  );
}

export function SiteFooter() {
  const path = usePathname();
  if (path?.endsWith("/report")) return null;
  return (
    <footer className="mt-20 border-t border-rule no-print">
      <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-10 text-xs text-slate sm:grid-cols-3 sm:px-6">
        <div>
          <div className="flex items-center gap-2 text-ink">
            <MarqueeMark size={20} />
            <span className="font-display text-sm">Marquee</span>
          </div>
          <p className="mt-2 max-w-xs">Sponsor discovery for events. Built by Team Enigma Trio for the Qloo Agentic Hackathon.</p>
        </div>
        <p className="font-mono uppercase tracking-wider">
          Taste data by <b className="text-ink">Qloo</b>
          <br />
          Agent powered by <b className="text-ink">Groq</b>
        </p>
        <p>Demo scenario: fictional events with real performers, teams and brands as taste signals. Not affiliated with or endorsed by Live Nation or any performer, team or brand shown.</p>
      </div>
    </footer>
  );
}
