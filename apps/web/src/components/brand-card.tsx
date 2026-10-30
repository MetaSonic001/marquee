"use client";

import { motion, useReducedMotion } from "motion/react";
import { Copy, EyeOff, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import { cn, fmtLocal, fmtMomentum, fmtOverlap, fmtTaste, fmtTasteSub, talkingPoints } from "@/lib/format";
import { effectiveWeights } from "@/lib/scoring";
import type { Lens } from "@/lib/scoring";
import type { BrandMatch, Metrics } from "@/lib/types";
import { BrandLogo, FitBar, InfoTip, SourceChip, Tip } from "./ui";

export function MetricCell({ label, term, value, sub, tone }: { label: string; term: string; value: string; sub?: string; tone?: "up" | "down" }) {
  const na = value === "n/a";
  const flat = value === "Flat";
  return (
    <div className="min-w-0 px-2.5 py-2 first:pl-0">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-slate">
        {label}
        <InfoTip term={term} />
      </div>
      {na ? (
        <Tip content="Qloo didn't return enough data for this metric. The Fit re-weights the other components instead of guessing.">
          <div className="font-mono text-[15px] text-slate/70">n/a</div>
        </Tip>
      ) : flat ? (
        <Tip content="Qloo's weekly trend series for this brand is flat over the available window, so momentum isn't counted in the Fit.">
          <div className="font-mono text-[15px] font-medium text-slate">Flat</div>
        </Tip>
      ) : (
        <div className={cn("font-mono text-[15px] font-medium tabular leading-tight", tone === "up" && "text-moss", tone === "down" && "text-stage")}>{value}</div>
      )}
      {sub && !na && <div className="truncate text-[10px] text-slate">{sub}</div>}
    </div>
  );
}

export function MetricsRow({ m }: { m: Metrics }) {
  return (
    <div className="grid grid-cols-2 divide-rule border-y border-rule sm:grid-cols-4 sm:divide-x">
      <MetricCell label="Taste match" term="taste" value={fmtTaste(m)} sub={fmtTasteSub(m)} />
      <MetricCell label="Overlap" term="overlap" value={fmtOverlap(m)} sub={m.overlap_pct != null ? `${m.overlap_pct}% of top tastes` : undefined} />
      <MetricCell label="Local" term="local" value={fmtLocal(m)} sub={m.local_city ? `of areas in ${m.local_city}` : undefined} />
      <MetricCell
        label="Momentum"
        term="momentum"
        value={fmtMomentum(m)}
        sub={m.momentum_flat ? `pop. pctl ${m.popularity_pctl ?? "—"} · steady` : "12 months"}
        tone={m.momentum_pct == null ? undefined : m.momentum_pct >= 0 ? "up" : "down"}
      />
    </div>
  );
}

export function FitNumber({ fit, size = "lg" }: { fit: number; size?: "lg" | "sm" }) {
  return (
    <div className="text-right">
      <div className={cn("font-display font-black leading-none tabular", size === "lg" ? "text-[44px]" : "text-3xl")}>{Math.round(fit)}</div>
      <div className="flex items-center justify-end gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate">
        Fit <InfoTip term="fit" />
      </div>
    </div>
  );
}

export function BrandCard({
  b,
  fit,
  lens,
  index,
  eventName,
  editable,
  onOpen,
  onSave,
  onHide,
  compareChecked,
  onCompare,
  animateIn,
}: {
  b: BrandMatch;
  fit: number;
  lens: Lens;
  index: number;
  eventName: string;
  editable: boolean;
  onOpen: () => void;
  onSave: () => void;
  onHide: () => void;
  compareChecked: boolean;
  onCompare: (v: boolean) => void;
  animateIn: boolean;
}) {
  const reduce = useReducedMotion();
  const weights = effectiveWeights(b.components, lens);
  const sp = b.sponsor_activity || {};
  return (
    <motion.article
      layout={!reduce}
      initial={animateIn && !reduce ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: animateIn && !reduce ? Math.min(index, 10) * 0.04 : 0, layout: { duration: 0.25 } }}
      className="group relative flex flex-col pass"
      data-testid="brand-card"
      data-brand={b.name}
      onClick={(e) => {
        // open the drawer from anywhere on the card except its own controls
        if ((e.target as HTMLElement).closest("button:not([data-open]), a, input, label")) return;
        onOpen();
      }}
      style={{ cursor: "pointer" }}
    >
      <div className="pointer-events-none relative z-[1] flex items-start gap-3 p-4 pb-3">
        <BrandLogo name={b.name} src={b.logo_url} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate">#{index + 1}</span>
            {b.is_existing && <span className="rounded-full bg-bulb px-2 py-[1px] text-[9px] font-bold uppercase tracking-wider text-[#0c0c0d]">Existing</span>}
          </div>
          <h3 className="name truncate text-[32px] leading-[1.05]">
            <button type="button" data-open className="pointer-events-auto text-left hover:text-bulb" aria-label={`Open ${b.name} details`}>
              {b.name}
            </button>
          </h3>
          <p className="truncate text-xs text-slate">{b.category}</p>
        </div>
        <FitNumber fit={fit} />
      </div>
      <div className="pointer-events-auto relative z-[1] px-4 pb-3">
        <FitBar components={b.components} weights={weights} />
      </div>
      <div className="pointer-events-none relative z-[1] px-4">
        <MetricsRow m={b.metrics} />
      </div>
      <div className="pointer-events-none relative z-[1] flex-1 px-4 pt-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate">Why your crowd loves them</p>
        <ul className="space-y-1.5">
          {b.why.slice(0, 3).map((w, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink" />
              <span>
                {w.text} <SourceChip label={w.source} className="ml-0.5 align-[1px]" />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="pointer-events-auto relative z-[1] mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-xs">
        {sp.count ? (
          <Tip
            content={
              <span className="block space-y-1">
                {(sp.findings || []).slice(0, 4).map((f, i) => (
                  <span key={i} className="block">
                    {f.event} {f.year && `(${f.year})`} — <span className="text-bulb">{f.source_domain}</span>
                  </span>
                ))}
              </span>
            }
          >
            <span className="inline-flex items-center gap-1 rounded-[3px] border border-moss/50 bg-moss/10 px-1.5 py-0.5 font-medium text-moss">● {sp.summary}</span>
          </Tip>
        ) : (
          <span className="inline-flex items-center gap-1 text-slate">○ {sp.summary || "Not researched"}</span>
        )}
      </div>
      <div className="pointer-events-auto relative z-[1] perf mt-4 flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="min-w-0 truncate text-xs">
          <span className="font-semibold">Where to start:</span> <span className="text-slate">{b.start_here?.activation || "—"}</span>
          {b.start_here?.partnerships_page && (
            <a href={b.start_here.partnerships_page} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 underline">
              partnerships <ExternalLink size={10} />
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <label className="mr-1 flex cursor-pointer items-center gap-1 text-[11px] text-slate">
            <input type="checkbox" className="accent-ink" checked={compareChecked} onChange={(e) => onCompare(e.target.checked)} aria-label={`Compare ${b.name}`} />
            Compare
          </label>
          <Tip content={b.saved ? "Saved — click to unsave" : editable ? "Save to shortlist" : "Duplicate the sample to save"}>
            <button type="button" onClick={onSave} disabled={!editable} className="rounded p-1.5 hover:bg-paper-2 disabled:opacity-40" aria-label={b.saved ? `Unsave ${b.name}` : `Save ${b.name}`} aria-pressed={!!b.saved}>
              <Star size={16} className={b.saved ? "fill-bulb text-ink" : ""} />
            </button>
          </Tip>
          <Tip content="Copy talking points">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(talkingPoints(b, fit, eventName));
                toast.success(`Talking points for ${b.name} copied`);
              }}
              className="rounded p-1.5 hover:bg-paper-2"
              aria-label={`Copy talking points for ${b.name}`}
            >
              <Copy size={15} />
            </button>
          </Tip>
          <Tip content={editable ? "Hide" : "Duplicate the sample to hide"}>
            <button type="button" onClick={onHide} disabled={!editable} className="rounded p-1.5 hover:bg-paper-2 disabled:opacity-40" aria-label={`Hide ${b.name}`}>
              <EyeOff size={15} />
            </button>
          </Tip>
        </div>
      </div>
    </motion.article>
  );
}
