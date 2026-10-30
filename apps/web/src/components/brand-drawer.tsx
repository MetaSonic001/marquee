"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import { COMPONENTS, COMPONENT_LABELS, effectiveWeights, fitScore } from "@/lib/scoring";
import type { Lens } from "@/lib/scoring";
import type { BrandMatch } from "@/lib/types";
import { DivergingTags, LocalBars, OverlapDisc, Sparkline } from "./charts";
import { FitNumber, MetricsRow } from "./brand-card";
import { BrandLogo, FitBar, SourceChip } from "./ui";

function rawValue(b: BrandMatch, k: string): string {
  const m = b.metrics;
  switch (k) {
    case "taste":
      return m.taste_rank ? `rank #${m.taste_rank} of ${m.taste_n} (Qloo affinity ${m.taste_affinity?.toFixed(3) ?? "—"})` : "n/a";
    case "overlap":
      return m.overlap_shared != null ? `${m.overlap_shared} of ${m.overlap_of} top tastes shared` : "n/a";
    case "local":
      return m.local_affinity_rank != null ? `mean affinity_rank ${m.local_affinity_rank.toFixed(3)} in ${m.local_city}` : "n/a";
    case "momentum":
      return m.momentum_rel != null ? `${(m.momentum_rel * 100).toFixed(1)}% change in popularity percentile` : "n/a";
    case "sponsor":
      return m.sponsor_findings != null ? `${m.sponsor_findings} cited findings` : "not researched";
  }
  return "";
}

export function BrandDrawer({ b, lens, open, onOpenChange }: { b: BrandMatch | null; lens: Lens; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/35" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-[640px] flex-col overflow-hidden border-l border-rule bg-paper shadow-2xl data-[state=open]:animate-[slidein_.22s_ease-out]"
          aria-describedby={undefined}
        >
          <style>{`@keyframes slidein{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}`}</style>
          {b && <DrawerBody b={b} lens={lens} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({ b, lens }: { b: BrandMatch; lens: Lens }) {
  const fit = fitScore(b.components, lens);
  const weights = effectiveWeights(b.components, lens);
  const ov = b.overlap || {};
  const sp = b.sponsor_activity || {};
  return (
    <>
      <div className="flex items-start gap-4 border-b border-rule bg-night px-6 py-5 text-ink">
        <BrandLogo name={b.name} src={b.logo_url} size={56} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-bulb">{b.shelf === "natural" ? "Natural fit" : b.shelf === "hidden" ? "Hidden gem" : b.shelf === "local" ? "Local hero" : "Brand check"} · {b.category}</p>
          <Dialog.Title className="name text-5xl leading-none">{b.name}</Dialog.Title>
          {b.description && <p className="mt-1.5 line-clamp-2 text-xs text-ink/70">{b.description}</p>}
        </div>
        <div className="text-bulb [&_*]:!text-bulb">
          <FitNumber fit={fit} />
        </div>
        <Dialog.Close className="rounded p-1 text-ink/80 hover:bg-white/10" aria-label="Close">
          <X size={18} />
        </Dialog.Close>
      </div>
      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
        <MetricsRow m={b.metrics} />

        {b.shelf !== "local" && (
          <section>
            <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">The overlap</h3>
            <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
              <OverlapDisc overlap={ov} brand={b.name} />
              <div>
                <p className="mb-2 text-xs text-slate">Shared tastes (signals carrying the tag: crowd / brand fans)</p>
                {ov.available && ov.shared?.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {ov.shared.map((s) => (
                      <li key={s.tag_id} className="rounded-[3px] border border-rule bg-bulb px-2 py-0.5 text-xs">
                        {s.name} <span className="font-mono text-[10px] opacity-70">{s.crowd}/{s.brand}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate">{ov.reason || "No shared tastes measured."}</p>
                )}
                {!!ov.brand_fan_artists?.length && (
                  <p className="mt-3 text-xs">
                    <span className="text-slate">{b.name} fans over-index on: </span>
                    {ov.brand_fan_artists.slice(0, 6).map((a) => a.name).join(", ")} <SourceChip label="Qloo · recommend" />
                  </p>
                )}
              </div>
            </div>
            {ov.available && (
              <div className="mt-5">
                <DivergingTags overlap={ov} brand={b.name} />
              </div>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">Why your crowd loves them</h3>
          <ul className="space-y-2">
            {b.why.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                <span>
                  {w.text} <SourceChip label={w.source} />
                </span>
              </li>
            ))}
          </ul>
          {b.start_here?.activation && (
            <p className="mt-3 rounded border border-rule bg-paper-2/60 px-3 py-2 text-sm">
              <b>Where to start: {b.start_here.activation}.</b> <span className="text-slate">{b.start_here.reason}</span>
              {b.start_here.partnerships_page && (
                <a className="ml-1 inline-flex items-center gap-0.5 underline" href={b.start_here.partnerships_page} target="_blank" rel="noreferrer">
                  Partnerships page <ExternalLink size={11} />
                </a>
              )}
            </p>
          )}
        </section>

        {b.shelf !== "local" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">Local strength</h3>
              <LocalBars hotspots={b.local?.national_hotspots || []} city={b.local?.city} />
              <p className="mt-1 text-[10px] text-slate">Top areas nationally by Qloo affinity rank (where_popular). Event city in red.</p>
            </section>
            <section>
              <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">12-month trend</h3>
              <Sparkline trend={b.trend || {}} height={90} />
              <p className="mt-1 text-[10px] text-slate">Qloo popularity percentile, weekly (trends).</p>
            </section>
          </div>
        )}

        <section>
          <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">Sponsor activity on the web</h3>
          <p className="text-sm font-medium">{sp.summary || "Not researched"}</p>
          {!!sp.findings?.length && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {sp.findings.map((f, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-slate">[{i + 1}]</span>
                  <span>
                    {f.event} {f.year && <span className="text-slate">({f.year})</span>} —{" "}
                    <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-bulb decoration-2 underline-offset-2">
                      {f.source_title || f.source_domain}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-slate">Public sources only; may miss private deals. Findings are kept only if their source appeared in the executed search.</p>
        </section>

        <section className="rounded-md border border-rule">
          <h3 className="border-b border-rule bg-paper-2 px-3 py-2 font-display text-lg font-extrabold uppercase tracking-wide">How this score was calculated</h3>
          <div className="p-3">
            <FitBar components={b.components} weights={weights} className="mb-3" />
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate">
                  <th className="py-1">Component</th>
                  <th>Weight</th>
                  <th>Score</th>
                  <th>Raw value</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {COMPONENTS.map((k) => (
                  <tr key={k} className="border-t border-rule">
                    <td className="py-1.5 font-sans font-medium">{COMPONENT_LABELS[k]}</td>
                    <td>{weights[k] == null ? "—" : `${weights[k]}%`}</td>
                    <td>{b.components[k] == null ? "n/a" : Math.round((b.components[k] as number) * 100)}</td>
                    <td className="text-[11px] text-slate">{rawValue(b, k)}</td>
                  </tr>
                ))}
                <tr className="border-t border-rule font-bold">
                  <td className="py-1.5 font-sans">Marquee Fit</td>
                  <td>100%</td>
                  <td>{Math.round(fit)}</td>
                  <td className="font-sans text-[11px] font-normal text-slate">Weighted mean of available components; see docs/SCORING.md</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p className="font-mono text-[10px] text-slate">Qloo entity {b.qloo_entity_id}</p>
      </div>
    </>
  );
}
