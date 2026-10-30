"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BrandMatch, EventFull } from "@/lib/types";
import { BrandDrawer } from "@/components/brand-drawer";
import { BrandLogo, Empty, Skeleton } from "@/components/ui";

type Portfolio = {
  columns: { id: string; name: string; logo_url?: string; category?: string }[];
  rows: { event_id: string; name: string; type: string; city?: string; is_sample: boolean; cells: Record<string, { fit: number; match_id: string } | null> }[];
  best_property: { brand: string; brand_id: string; event: string; event_id: string; fit: number }[];
  undersold: { event_id: string; event: string; category: string; top_brand: string; fit: number; brands: number }[];
};

function heat(fit: number) {
  // paper -> bulb -> ink as fit rises
  if (fit >= 80) return { bg: "#FF5A1F", fg: "#0C0C0D" };
  if (fit >= 70) return { bg: "#C2441A", fg: "#EEE9E0" };
  if (fit >= 60) return { bg: "#7A2F12", fg: "#EEE9E0" };
  if (fit >= 45) return { bg: "#3A2418", fg: "#EEE9E0" };
  return { bg: "#1C1C1F", fg: "#8D8880" };
}

export default function PortfolioPage() {
  const { data, isLoading } = useQuery({ queryKey: ["portfolio"], queryFn: () => api<Portfolio>("/portfolio") });
  const [open, setOpen] = useState<{ eventId: string; matchId: string } | null>(null);
  const { data: ev } = useQuery({ queryKey: ["event", open?.eventId], queryFn: () => api<EventFull>(`/events/${open!.eventId}`), enabled: !!open });
  const match: BrandMatch | null = (open && ev?.matches.find((m) => m.id === open.matchId)) || null;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-8 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Demo scenario · a promoter&apos;s partnerships team</p>
      <h1 className="font-display text-5xl font-black uppercase leading-none tracking-wide sm:text-6xl">Portfolio</h1>
      <p className="mt-2 max-w-3xl text-slate">
        Every property × every top brand, colored by Marquee Fit. The same brand fits different crowds very differently — and the gaps are new revenue. Computed purely from stored Qloo matches.
      </p>
      <p className="mt-1 text-[11px] text-slate">Fictional events with real performers, teams and brands as taste signals. Not affiliated with or endorsed by Live Nation or any performer, team or brand shown.</p>

      {isLoading && <Skeleton className="mt-8 h-72 w-full" />}
      {data && data.rows.length === 0 && <Empty title="No events with results yet">Add an event and run discovery.</Empty>}
      {data && data.rows.length > 0 && (
        <>
          <div className="mt-8 overflow-x-auto rounded-md border border-rule bg-paper" data-testid="portfolio-grid">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[200px] border-b border-r border-rule bg-paper-2 px-3 py-2 text-left font-display text-lg font-extrabold uppercase">Property</th>
                  {data.columns.map((c) => (
                    <th key={c.id} className="h-36 w-12 border-b border-rule px-1 align-bottom">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="whitespace-nowrap text-[11px] font-semibold [writing-mode:vertical-rl] rotate-180">{c.name}</span>
                        <BrandLogo name={c.name} src={c.logo_url} size={22} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.event_id}>
                    <th className="sticky left-0 z-10 border-r border-t border-rule bg-paper px-3 py-2 text-left">
                      <Link href={`/events/${r.event_id}`} className="font-display text-xl font-extrabold uppercase leading-none hover:underline">
                        {r.name}
                      </Link>
                      <p className="text-[11px] font-normal text-slate">
                        {r.type}
                        {r.city ? ` · ${r.city}` : ""}
                      </p>
                    </th>
                    {data.columns.map((c) => {
                      const cell = r.cells[c.id];
                      if (!cell) return <td key={c.id} className="border-t border-rule text-center font-mono text-[10px] text-slate/50">·</td>;
                      const h = heat(cell.fit);
                      return (
                        <td key={c.id} className="border-t border-l border-paper p-0">
                          <button
                            onClick={() => setOpen({ eventId: r.event_id, matchId: cell.match_id })}
                            className="h-12 w-12 font-mono text-xs font-bold transition-transform hover:scale-110 hover:outline hover:outline-2 hover:outline-ink"
                            style={{ background: h.bg, color: h.fg }}
                            aria-label={`${c.name} for ${r.name}: fit ${Math.round(cell.fit)}`}
                            data-testid="portfolio-cell"
                          >
                            {Math.round(cell.fit)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate">
            Fit:
            {[40, 50, 65, 75, 85].map((f) => (
              <span key={f} className="flex items-center gap-1">
                <i className="inline-block h-3 w-5 rounded-sm" style={{ background: heat(f).bg }} /> {f === 40 ? "<45" : f === 85 ? "80+" : `${f}`}
              </span>
            ))}
            · “·” = not in that property&apos;s shortlist
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 font-display text-3xl font-black uppercase tracking-wide">Best property for each brand</h2>
              <ul className="divide-y divide-rule rounded-md border border-rule bg-paper">
                {data.best_property.slice(0, 12).map((b) => (
                  <li key={b.brand_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <b>{b.brand}</b>
                    <span className="text-slate">
                      → <Link href={`/events/${b.event_id}`} className="text-ink underline">{b.event}</Link> <span className="font-mono">{Math.round(b.fit)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="mb-1 font-display text-3xl font-black uppercase tracking-wide">Under-sold categories</h2>
              <p className="mb-3 text-sm text-slate">Categories that score highly for a property but have no saved or existing sponsor — the next sale inbound demand won&apos;t surface.</p>
              <ul className="space-y-2">
                {data.undersold.map((u, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper px-3 py-2 text-sm">
                    <span>
                      <b className="font-display text-lg font-extrabold uppercase">{u.category}</b> <span className="text-slate">at {u.event}</span>
                    </span>
                    <span className="text-right text-xs">
                      lead: <b>{u.top_brand}</b> <span className="font-mono">{Math.round(u.fit)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      <BrandDrawer b={match} lens="balanced" open={!!match} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
