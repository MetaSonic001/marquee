"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { api, streamSSE } from "@/lib/api";
import { cn } from "@/lib/format";
import { fitScore } from "@/lib/scoring";
import type { Lens } from "@/lib/scoring";
import type { BrandMatch, EventFull } from "@/lib/types";
import { FitNumber, MetricsRow } from "./brand-card";
import { BrandDrawer } from "./brand-drawer";
import { EntityPicker } from "./entity-picker";
import { BrandLogo, Empty, SourceChip, ToolBadge } from "./ui";

const VERDICT_STYLE: Record<string, string> = {
  "Strong fit": "bg-moss text-paper",
  "Good fit": "bg-bulb text-ink",
  "Weak fit": "bg-paper-3 text-ink",
};

export function CheckTab({ ev, lens }: { ev: EventFull; lens: Lens }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ tool?: string; summary: string }[]>([]);
  const [open, setOpen] = useState<BrandMatch | null>(null);
  const checks = ev.checks.map((c) => ({ ...c, shelf: "check" as const, start_here: {} }));
  const sorted = [...checks].sort((a, b) => fitScore(b.components, lens) - fitScore(a.components, lens));

  const run = async (id: string, name: string) => {
    setBusy(name);
    setLog([]);
    try {
      await streamSSE(
        `/events/${ev.id}/check-brand`,
        (e) => {
          if (e.kind === "tool_call") setLog((l) => [...l, { tool: e.tool, summary: e.summary }]);
          if (e.kind === "error") toast.error(e.summary);
        },
        { method: "POST", json: { qloo_entity_id: id, name } },
      );
      await qc.invalidateQueries({ queryKey: ["event", ev.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <aside className="space-y-4">
        <div className="rounded-md border border-rule bg-paper p-4">
          <h2 className="font-display text-3xl font-black uppercase leading-none tracking-wide">Check a brand</h2>
          <p className="mt-1 text-sm text-slate">A brand came to you? Get a quantified fit report against this crowd — and compare inbound offers for category exclusivity.</p>
          <div className="mt-3">
            {ev.editable ? (
              <EntityPicker type="brand" placeholder="Type any brand, e.g. Liquid Death" buttonLabel="Check" disabled={!!busy} onPick={(p) => run(p.id, p.name)} testId="check-brand-input" />
            ) : (
              <p className="rounded bg-paper-2 p-2 text-xs">Sample events are read-only. Use “Duplicate to edit” to check your own brands.</p>
            )}
          </div>
        </div>
        {busy && (
          <div className="rounded-md border border-rule bg-night p-3 text-ink" aria-live="polite">
            <p className="mb-2 flex items-center gap-2 font-display text-lg font-extrabold uppercase">
              <span className="live-dot" /> Checking {busy}
            </p>
            <ul className="space-y-1 font-mono text-[11px]">
              {log.slice(-7).map((l, i) => (
                <li key={i} className="flex gap-2">
                  {l.tool && <ToolBadge tool={l.tool} />} <span className="text-ink/80">{l.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
      <div>
        {sorted.length === 0 ? (
          <Empty title="No brands checked yet">Checked brands line up here side by side, ranked by fit.</Empty>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate">
              {sorted.length} inbound {sorted.length === 1 ? "brand" : "brands"} compared · ranked by Marquee Fit for this crowd
            </p>
            <div className={cn("grid gap-4", sorted.length > 1 && "lg:grid-cols-2")} data-testid="check-results">
              {sorted.map((c, i) => (
                <article key={c.id} className="flex flex-col pass" data-testid="check-card">
                  <div className="flex items-start gap-3 p-4 pb-2">
                    <span className="font-display text-2xl font-black text-slate">{i + 1}</span>
                    <BrandLogo name={c.name} src={c.logo_url} size={42} />
                    <div className="min-w-0 flex-1">
                      <button className="name block w-full truncate text-left text-3xl leading-none hover:text-bulb" onClick={() => setOpen(c)}>
                        {c.name}
                      </button>
                      <p className="text-xs text-slate">{c.category}</p>
                      <span className={cn("mt-1 inline-block rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", VERDICT_STYLE[c.verdict || "Weak fit"])} data-testid="verdict">
                        {c.verdict}
                      </span>
                    </div>
                    <FitNumber fit={fitScore(c.components, lens)} size="sm" />
                  </div>
                  <div className="px-4">
                    <MetricsRow m={c.metrics} />
                  </div>
                  <ul className="flex-1 space-y-1.5 px-4 py-3 text-[13px]">
                    {c.why.map((w, j) => (
                      <li key={j}>
                        • {w.text} <SourceChip label={w.source} />
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-rule px-4 py-2 text-xs text-slate">
                    <span className="truncate">{c.sponsor_activity?.summary}</span>
                    {ev.editable && (
                      <button
                        aria-label={`Remove ${c.name}`}
                        className="rounded p-1 hover:bg-paper-2"
                        onClick={async () => {
                          await api(`/checks/${c.id}`, { method: "DELETE" });
                          qc.invalidateQueries({ queryKey: ["event", ev.id] });
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
      <BrandDrawer b={open} lens={lens} open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
