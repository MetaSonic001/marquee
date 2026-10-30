"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtOverlap, fmtTaste } from "@/lib/format";
import type { BrandMatch, EventFull } from "@/lib/types";
import { BrandLogo, Button, SourceChip } from "./ui";

export function LlmTab({ ev, ranked }: { ev: EventFull; ranked: (BrandMatch & { lensFit: number })[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const data = ev.llm_only;

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/events/${ev.id}/llm-only`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["event", ev.id] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!data && !busy && !err) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const marquee = ranked.filter((b) => b.shelf !== "local" && !b.is_existing).slice(0, 10);
  const marqueeNames = new Set(marquee.map((b) => b.name.toLowerCase()));
  const llmNames = new Set((data?.suggestions || []).map((s) => s.brand.toLowerCase()));
  const both = [...marqueeNames].filter((n) => llmNames.has(n)).length;

  return (
    <div>
      <p className="mb-5 max-w-3xl text-sm text-slate">
        Same brief, two answers. Left: one LLM call with no data tools. Right: Marquee&apos;s Qloo-grounded shortlist. {data && <b className="text-ink">They agree on {both} of 10.</b>}
      </p>
      <div className="grid gap-6 md:grid-cols-2" data-testid="llm-compare">
        <section className="rounded-md border border-dashed border-rule bg-paper-2/50 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-3xl font-black uppercase tracking-wide text-slate">LLM only</h2>
            <span className="font-mono text-[10px] uppercase text-slate">no evidence</span>
          </div>
          {busy && !data && (
            <p className="flex items-center gap-2 text-sm text-slate">
              <Loader2 size={14} className="animate-spin" /> Asking a plain LLM…
            </p>
          )}
          {err && (
            <div className="text-sm text-slate">
              Couldn&apos;t reach the LLM: {err}{" "}
              <Button variant="outline" className="ml-2 py-1 text-xs" onClick={load}>
                Retry
              </Button>
            </div>
          )}
          <ol className="space-y-2">
            {(data?.suggestions || []).map((s, i) => (
              <li key={i} className="rounded border border-rule bg-paper px-3 py-2">
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-slate">{i + 1}</span>
                  <b className="name text-2xl">{s.brand}</b>
                  <span className="text-xs text-slate">{s.category}</span>
                </p>
                <p className="text-xs text-slate">{s.reason}</p>
                <p className="mt-1 font-mono text-[10px] uppercase text-slate/70">No numbers · no sources</p>
              </li>
            ))}
          </ol>
          {data?.model && <p className="mt-2 font-mono text-[10px] text-slate">model: {data.model} · cached per event</p>}
        </section>
        <section className="rounded-md border border-rule bg-paper p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-3xl font-black uppercase tracking-wide">Marquee</h2>
            <span className="font-mono text-[10px] uppercase">Qloo-grounded</span>
          </div>
          <ol className="space-y-2">
            {marquee.map((b, i) => (
              <li key={b.id} className="rounded border border-rule px-3 py-2">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate">{i + 1}</span>
                  <BrandLogo name={b.name} src={b.logo_url} size={22} />
                  <b className="name text-2xl">{b.name}</b>
                  <span className="ml-auto font-display text-2xl font-black">{Math.round(b.lensFit)}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  <SourceChip label={`rank ${fmtTaste(b.metrics)}`} />
                  <SourceChip label={`overlap ${fmtOverlap(b.metrics)}`} />
                  {b.sponsor_activity?.count ? <SourceChip label={`web · ${b.sponsor_activity.count} cited`} /> : null}
                </p>
                {b.why[0] && <p className="mt-1 text-xs">{b.why[0].text}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
