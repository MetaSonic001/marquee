"use client";

import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtLocal, fmtMomentum, fmtOverlap, fmtTaste, SHELF_COPY } from "@/lib/format";
import { fitScore, isLens, LENS_LABELS } from "@/lib/scoring";
import type { EventFull } from "@/lib/types";
import { rankSlot } from "@/components/slots-tab";

export default function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const lensQ = sp.get("lens");
  const lens = isLens(lensQ) ? lensQ : "balanced";
  const shelf = sp.get("shelf");
  const cat = sp.get("category");
  const min = Number(sp.get("min_fit") || 0);
  const { data: ev } = useQuery({ queryKey: ["event", id], queryFn: () => api<EventFull>(`/events/${id}`) });

  useEffect(() => {
    if (ev) {
      const t = setTimeout(() => window.print(), 900);
      return () => clearTimeout(t);
    }
  }, [ev]);

  if (!ev) return <p className="p-10 font-mono text-sm">Preparing report…</p>;
  const rows = ev.matches
    .filter((m) => !m.hidden && (!shelf || m.shelf === shelf) && (!cat || m.category_key === cat))
    .map((m) => ({ ...m, f: fitScore(m.components, lens) }))
    .filter((m) => m.f >= min)
    .sort((a, b) => b.f - a.f);
  const saved = rows.filter((r) => r.saved);
  const slots = ev.slots.filter((s) => s.ranking.length >= 2);

  return (
    <div className="mx-auto max-w-[860px] bg-white px-10 py-10 text-ink print:p-0">
      <style>{`@page{size:A4;margin:14mm} body{background:#fff}`}</style>
      <div className="no-print mb-6 flex justify-between rounded border border-rule bg-bulb-soft px-3 py-2 text-sm">
        <span>Use your browser&apos;s “Save as PDF” in the print dialog.</span>
        <button className="underline" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>
      <header className="border-b-4 border-rule pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em]">Marquee · Sponsor Shortlist</p>
        <h1 className="font-display text-5xl font-black uppercase leading-none">Sponsor Shortlist — {ev.name}</h1>
        <p className="mt-1 text-sm">
          {[ev.type_label, ev.city, ev.dates, ev.attendance ? `~${ev.attendance.toLocaleString()} attendees` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-xs text-slate">
          Ranking lens: {LENS_LABELS[lens]} · Crowd signals: {ev.crowd_signals.filter((s) => s.status === "resolved").map((s) => s.display_name).join(", ")}
        </p>
      </header>

      {ev.crowd?.summary && (
        <section className="mt-5">
          <h2 className="font-display text-2xl font-extrabold uppercase">Your crowd</h2>
          <p className="text-sm leading-relaxed">{ev.crowd.summary}</p>
        </section>
      )}

      {slots.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="font-display text-2xl font-extrabold uppercase">Ideal sponsor lineup (one per category)</h2>
          <table className="mt-1 w-full text-sm">
            <tbody>
              {slots.map((s) => {
                const r = rankSlot(s, lens);
                return (
                  <tr key={s.id} className="border-t border-rule">
                    <td className="py-1 font-medium">{s.name}</td>
                    <td>{r.tooClose ? "Too close to call: " : ""}<b>{r.rows[0]?.name}</b> ({Math.round(r.rows[0]?.lensScore ?? 0)})</td>
                    <td className="text-slate">runner-up {r.rows[1]?.name} · margin {r.margin}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {saved.length > 0 && (
        <p className="mt-5 text-sm">
          <b>Saved ({saved.length}):</b> {saved.map((s) => s.name).join(", ")}
        </p>
      )}

      {(["natural", "hidden", "local"] as const).map((sh) => {
        const items = rows.filter((r) => r.shelf === sh);
        if (!items.length) return null;
        return (
          <section key={sh} className="mt-6">
            <h2 className="border-b border-rule font-display text-3xl font-black uppercase">{SHELF_COPY[sh].title}</h2>
            <p className="mb-2 text-xs text-slate">{SHELF_COPY[sh].blurb(ev.type_label)}</p>
            {items.map((b) => (
              <article key={b.id} className="break-inside-avoid border-b border-rule py-2.5">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-xl font-extrabold uppercase">
                    {b.name} <span className="font-sans text-xs font-normal normal-case text-slate">{b.category}{b.saved ? " · ★ saved" : ""}{b.is_existing ? " · existing sponsor" : ""}</span>
                  </h3>
                  <span className="font-display text-2xl font-black">{Math.round(b.f)}</span>
                </div>
                <p className="font-mono text-[11px]">
                  Taste {fmtTaste(b.metrics)} · Overlap {fmtOverlap(b.metrics)} · Local {fmtLocal(b.metrics)} · Momentum {fmtMomentum(b.metrics)}
                </p>
                <ul className="mt-1 text-[12px]">
                  {b.why.map((w, i) => (
                    <li key={i}>
                      • {w.text} <span className="text-slate">[{w.source}]</span>
                    </li>
                  ))}
                </ul>
                {b.sponsor_activity?.summary && <p className="text-[11px] text-slate">{b.sponsor_activity.summary}{b.sponsor_activity.citations?.length ? ` — ${b.sponsor_activity.citations.map((c) => c.url).join(", ")}` : ""}</p>}
              </article>
            ))}
          </section>
        );
      })}
      <footer className="mt-8 border-t border-rule pt-2 text-[10px] text-slate">
        Taste data: Qloo (aggregate affinities, not individuals). Fit = audience alignment, not guaranteed ROI. Web findings are cited and may miss private deals. Generated by Marquee.
      </footer>
    </div>
  );
}
