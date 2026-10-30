"use client";

import { pack, hierarchy } from "d3-hierarchy";
import { useMemo, useState } from "react";
import type { CrowdProfile, EventFull } from "@/lib/types";
import { Empty, SourceChip } from "./ui";

const DOMAIN_COLORS: Record<string, string> = {
  Music: "#EEE9E0",
  Brands: "#FF5A1F",
  TV: "#F2C14E",
  Film: "#6E6A64",
  Podcasts: "#5AD19A",
  Books: "#C9A27A",
  Games: "#8FA3FF",
  Places: "#E9826B",
};

type Leaf = { name: string; value: number; domain: string; affinity: number | null };

export function CrowdFingerprint({ crowd, size = 560 }: { crowd: CrowdProfile; size?: number }) {
  const [hover, setHover] = useState<Leaf | null>(null);
  const root = useMemo(() => {
    const children = Object.entries(crowd.fingerprint).map(([domain, items]) => ({
      name: domain,
      children: items.slice(0, 7).map((i) => ({ name: i.name, value: Math.max(0.05, (i.affinity ?? 0.5) ** 3), domain, affinity: i.affinity ?? null })),
    }));
    const h = hierarchy<{ name: string; children?: unknown[]; value?: number }>({ name: "crowd", children } as never).sum((d) => (d as { value?: number }).value ?? 0);
    return pack<{ name: string }>().size([size, size]).padding((d) => (d.depth === 0 ? 10 : 3))(h as never);
  }, [crowd, size]);

  const groups = root.children || [];
  const summary = Object.entries(crowd.fingerprint)
    .map(([d, items]) => `${d}: ${items.slice(0, 3).map((i) => i.name).join(", ")}`)
    .join(". ");
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label={`Crowd fingerprint. ${summary}`}>
        {groups.map((g) => {
          const color = DOMAIN_COLORS[(g.data as { name: string }).name] || "#EEE9E0";
          return (
            <g key={(g.data as { name: string }).name}>
              <circle cx={g.x} cy={g.y} r={g.r} fill={color} fillOpacity={0.07} stroke={color} strokeOpacity={0.5} strokeDasharray="3 3" />
              <text x={g.x} y={g.y - g.r + 14} textAnchor="middle" fontSize={11} fontFamily="var(--font-jetbrains)" fill={color} style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                {(g.data as { name: string }).name}
              </text>
              {(g.children || []).map((l) => {
                const d = l.data as unknown as Leaf;
                const dark = color === "#EEE9E0" || color === "#F2C14E" || color === "#3b4a8a" || color === "#5AD19A" || color === "#6E6A64" || color === "#b0452f" || color === "#8a6a3b";
                return (
                  <g key={d.name} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                    <circle cx={l.x} cy={l.y} r={l.r} fill={color} fillOpacity={hover && hover.name !== d.name ? 0.45 : 0.92} />
                    {l.r > 16 && (
                      <text x={l.x} y={l.y + 3} textAnchor="middle" fontSize={Math.min(12, l.r / 3.2)} fill="#0C0C0D" fontWeight={600} pointerEvents="none">
                        {d.name.length > l.r / 3.2 ? d.name.slice(0, Math.max(3, Math.floor(l.r / 3.6))) + "…" : d.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-ink px-2.5 py-1.5 text-xs text-paper">
          <b>{hover.name}</b> · {hover.domain} · affinity <span className="font-mono text-bulb">{hover.affinity?.toFixed(3) ?? "—"}</span>
        </div>
      )}
      <figcaption className="mt-1 text-[10px] text-slate">Bubble size ∝ Qloo affinity³ (qloo_recommend per domain). Hover for values.</figcaption>
    </figure>
  );
}

const AGE_LABELS: Record<string, string> = {
  "24_and_younger": "≤24",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

export function CrowdTab({ ev }: { ev: EventFull }) {
  const c = ev.crowd;
  if (!c) return <Empty title="No crowd profile yet">Run discovery to read your crowd&apos;s taste.</Empty>;
  const age = c.demographics?.age || {};
  const maxAbs = Math.max(0.01, ...Object.values(age).map((v) => Math.abs(v)));
  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
      <section className="rounded-md border border-rule bg-paper p-4">
        <h2 className="mb-2 font-display text-3xl font-black uppercase tracking-wide">Crowd fingerprint</h2>
        <CrowdFingerprint crowd={c} />
        <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
          {Object.keys(c.fingerprint).map((d) => (
            <span key={d} className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: DOMAIN_COLORS[d] || "#EEE9E0" }} />
              {d}
            </span>
          ))}
        </div>
      </section>
      <div className="space-y-6">
        <section className="rounded-md border border-rule bg-night p-5 text-ink">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-bulb">Your crowd in one paragraph</p>
          {c.summary ? (
            <p className="mt-2 text-[17px] leading-relaxed">{c.summary}</p>
          ) : (
            <p className="mt-2 text-sm text-ink/70">The summary writer was unavailable for this run. The fingerprint, tags and skew below are the raw Qloo data.</p>
          )}
          <p className="mt-3 text-[10px] text-ink/60">Written by a language model from the Qloo fingerprint only; cites {c.evidence?.cited_ids?.length ?? 0} Qloo entities.</p>
        </section>
        <section>
          <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">Crowd signals</h3>
          <div className="flex flex-wrap gap-1.5">
            {(c.evidence?.signals || []).map((s) => (
              <span key={s.id} className="rounded border border-rule px-2 py-0.5 text-xs">
                {s.name} <span className="font-mono text-[9px] uppercase text-slate">{s.type}</span>
              </span>
            ))}
          </div>
        </section>
        {Object.keys(age).length > 0 && (
          <section>
            <h3 className="mb-1 font-display text-xl font-extrabold uppercase tracking-wide">Age skew</h3>
            <p className="mb-2 text-xs text-slate">Relative to Qloo&apos;s baseline, averaged across signals. Aggregate only — never about individuals.</p>
            <div className="space-y-1">
              {Object.entries(age).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[52px_1fr_1fr_44px] items-center gap-1 text-xs">
                  <span className="font-mono">{AGE_LABELS[k] || k}</span>
                  <div className="flex justify-end">{v < 0 && <div className="h-3 rounded-l-[2px] bg-slate" style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} />}</div>
                  <div className="border-l border-rule">{v > 0 && <div className="h-3 rounded-r-[2px] bg-bulb" style={{ width: `${(v / maxAbs) * 100}%` }} />}</div>
                  <span className="text-right font-mono">{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1"><SourceChip label="Qloo · audience_demographics" /></div>
          </section>
        )}
        {c.tags?.length > 0 && (
          <section>
            <h3 className="mb-2 font-display text-xl font-extrabold uppercase tracking-wide">Top tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {c.tags.map((t) => (
                <span key={t.id} className="rounded-[3px] bg-paper-2 px-2 py-0.5 text-xs">
                  {t.name} <span className="font-mono text-[10px] text-slate">×{t.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate">How many of your signals carry each Qloo tag.</p>
          </section>
        )}
      </div>
    </div>
  );
}
