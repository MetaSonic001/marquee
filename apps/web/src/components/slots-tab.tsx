"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Copy, Loader2, Plus, RefreshCw, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { api, streamSSE } from "@/lib/api";
import { cn, fmtLocal, fmtMomentum, fmtOverlap, fmtTaste } from "@/lib/format";
import { fitScore } from "@/lib/scoring";
import type { Lens } from "@/lib/scoring";
import type { EventFull, RankingRow, Slot } from "@/lib/types";
import { EntityPicker } from "./entity-picker";
import { BrandLogo, Button, Empty, SourceChip, Tip, ToolBadge } from "./ui";

const EVIDENCE_LABEL: Record<string, string> = {
  "qloo:rank:slot": "Qloo · rank",
  "qloo:compare_audiences": "Qloo · compare_audiences",
  "qloo:where_popular": "Qloo · where_popular",
  "qloo:trends": "Qloo · trends",
};

type Scored = RankingRow & { lensScore: number };

export function rankSlot(slot: Slot, lens: Lens): { rows: Scored[]; margin: number | null; tooClose: boolean } {
  const rows = slot.ranking.map((r) => ({ ...r, lensScore: fitScore(r.components, lens) })).sort((a, b) => b.lensScore - a.lensScore);
  const margin = rows.length > 1 ? Math.round((rows[0].lensScore - rows[1].lensScore) * 10) / 10 : null;
  return { rows, margin, tooClose: margin !== null && margin < 5 };
}

export function SlotsTab({ ev, lens, onSaveWinner }: { ev: EventFull; lens: Lens; onSaveWinner: (qlooId: string) => void }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["event", ev.id] });
  const slots = [...ev.slots].sort((a, b) => a.order - b.order);

  const addSlot = async (name: string, category_key = "other") => {
    try {
      await api(`/events/${ev.id}/slots`, { method: "POST", json: { name, category_key } });
      setNewName("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-8">
      {/* summary strip */}
      <section aria-label="Ideal sponsor lineup" className="overflow-hidden rounded-md border border-rule bg-night text-ink">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <p className="font-display text-lg font-extrabold uppercase tracking-[0.18em] text-bulb">Your ideal sponsor lineup</p>
          <HowWePicked />
        </div>
        <div className="flex gap-px overflow-x-auto bg-white/10" data-testid="slot-strip">
          {slots.map((s) => {
            const { rows, tooClose } = rankSlot(s, lens);
            const w = rows[0];
            return (
              <a key={s.id} href={`#slot-${s.id}`} className="min-w-[170px] flex-1 bg-night px-4 py-3 hover:bg-ink">
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-ink/60">{s.name}</p>
                {w ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <BrandLogo name={w.name} src={w.logo_url} size={28} />
                    <div className="min-w-0">
                      <p className="name truncate text-2xl leading-none">{w.name}</p>
                      <p className="font-mono text-[11px] text-bulb">{Math.round(w.lensScore)} {tooClose && <span className="text-ink/60">· close call</span>}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink/50">Needs 2+ candidates</p>
                )}
              </a>
            );
          })}
        </div>
      </section>

      {slots.length === 0 && <Empty title="No slots yet">Add a category slot below — e.g. “Official beverage partner”.</Empty>}

      <div className="space-y-6">
        {slots.map((s) => (
          <SlotCard key={s.id} slot={s} ev={ev} lens={lens} onChanged={refresh} onSaveWinner={onSaveWinner} />
        ))}
      </div>

      {ev.editable ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-rule p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) addSlot(newName.trim(), guessKey(newName));
          }}
        >
          <span className="font-display text-xl font-extrabold uppercase">Add a slot</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Official beverage partner" className="min-w-[220px] flex-1 rounded-[5px] border border-rule bg-paper px-3 py-2 text-sm" aria-label="New slot name" data-testid="new-slot-input" />
          <Button type="submit" disabled={!newName.trim()}>
            <Plus size={14} /> Add slot
          </Button>
        </form>
      ) : (
        <p className="text-sm text-slate">Sample events are read-only. Use “Duplicate to edit” to add slots and candidates.</p>
      )}
    </div>
  );
}

function guessKey(name: string): string {
  const n = name.toLowerCase();
  if (/(beverage|drink|soda|water|beer)/.test(n)) return "beverage";
  if (/energy/.test(n)) return "energy_drink";
  if (/(apparel|fashion|clothing|merch)/.test(n)) return "apparel";
  if (/(food|delivery|restaurant)/.test(n)) return "food_delivery";
  if (/(telecom|wireless|mobile)/.test(n)) return "telecom";
  if (/(auto|car)/.test(n)) return "automotive";
  if (/(bank|financ|card|payment)/.test(n)) return "financial";
  if (/(tech|gaming|game)/.test(n)) return "tech_gaming";
  return "other";
}

function HowWePicked() {
  return (
    <Popover.Root>
      <Popover.Trigger className="text-xs text-ink/80 underline decoration-dotted underline-offset-2">How we picked</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="end" className="z-[70] w-80 space-y-2 rounded-md border border-rule bg-paper p-4 text-xs leading-relaxed text-ink shadow-xl">
          <p className="font-display text-lg font-extrabold uppercase">How we picked</p>
          <p>
            1. <b>Head-to-head:</b> <ToolBadge tool="qloo_rank" /> ranks the slot&apos;s candidates against your crowd&apos;s confirmed signals.
          </p>
          <p>
            2. <b>Evidence:</b> overlap (<ToolBadge tool="compare_audiences" />), city strength (<ToolBadge tool="where_popular" />) and momentum (<ToolBadge tool="trends" />) for each candidate.
          </p>
          <p>3. <b>Slot score</b> = the Marquee Fit formula, with taste match taken from the head-to-head position. The ranking lens applies here too.</p>
          <p>4. Excluded categories and existing sponsors are greyed out with the reason. Within 5 points we say “Too close to call”.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MiniDiverge({ a, b, label, aLabel, bLabel, higherBetter = true }: { a: number | null | undefined; b: number | null | undefined; label: string; aLabel: string; bLabel: string; higherBetter?: boolean }) {
  if (a == null || b == null) {
    return (
      <div className="grid grid-cols-[1fr_96px_1fr] items-center gap-2 text-xs">
        <span className="text-right font-mono text-slate">{aLabel}</span>
        <span className="text-center text-[10px] uppercase tracking-wider text-slate">{label}</span>
        <span className="font-mono text-slate">{bLabel}</span>
      </div>
    );
  }
  const max = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  const aWins = higherBetter ? a > b : a < b;
  const bWins = higherBetter ? b > a : b < a;
  const wa = higherBetter ? Math.abs(a) / max : Math.min(...[a, b].map(Math.abs)) / Math.max(Math.abs(a), 1e-9);
  const wb = higherBetter ? Math.abs(b) / max : Math.min(...[a, b].map(Math.abs)) / Math.max(Math.abs(b), 1e-9);
  return (
    <div className="grid grid-cols-[1fr_96px_1fr] items-center gap-2 text-xs">
      <div className="flex items-center justify-end gap-2">
        <span className={cn("font-mono", aWins && "font-bold")}>{aLabel}</span>
        <div className="h-2.5 w-20 overflow-hidden rounded-l-[2px] bg-paper-3">
          <div className="ml-auto h-full" style={{ width: `${Math.max(6, wa * 100)}%`, background: aWins ? "#FF5A1F" : "#6E6A64" }} />
        </div>
      </div>
      <span className="text-center text-[10px] uppercase tracking-wider text-slate">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-20 overflow-hidden rounded-r-[2px] bg-paper-3">
          <div className="h-full" style={{ width: `${Math.max(6, wb * 100)}%`, background: bWins ? "#FF5A1F" : "#6E6A64" }} />
        </div>
        <span className={cn("font-mono", bWins && "font-bold")}>{bLabel}</span>
      </div>
    </div>
  );
}

function SlotCard({ slot, ev, lens, onChanged, onSaveWinner }: { slot: Slot; ev: EventFull; lens: Lens; onChanged: () => void; onSaveWinner: (id: string) => void }) {
  const [ranking, setRanking] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [name, setName] = useState(slot.name);
  const { rows, margin, tooClose } = rankSlot(slot, lens);
  const [w, second, third] = rows;
  const excluded = slot.candidates.filter((c) => c.excluded_reason);
  const stale = !slot.ranked_at || slot.candidates.filter((c) => !c.excluded_reason).some((c) => !slot.ranking.find((r) => r.qloo_entity_id === c.qloo_entity_id));

  const patch = async (body: object) => {
    try {
      await api(`/slots/${slot.id}`, { method: "PATCH", json: body });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const rank = async () => {
    setRanking(true);
    setLog([]);
    try {
      await streamSSE(
        `/slots/${slot.id}/rank`,
        (e) => {
          if (e.kind === "tool_call") setLog((l) => [...l.slice(-4), `${e.tool} · ${e.summary}`]);
          if (e.kind === "error") toast.error(e.summary);
        },
        { method: "POST" },
      );
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRanking(false);
    }
  };
  const rationale = [
    w && `${slot.name}: ${tooClose ? "too close to call" : `best pick ${w.name}`} (slot score ${Math.round(w.lensScore)}${margin != null ? `, leads by ${margin}` : ""}).`,
    ...(slot.rationale?.bullets || []).map((b) => `• ${b.text}`),
    "Source: Qloo Taste AI via Marquee.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section id={`slot-${slot.id}`} className="scroll-mt-32 pass" data-testid="slot-card" data-slot={slot.name}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="flex items-center gap-3">
          {ev.editable ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== slot.name && name.trim() && patch({ name: name.trim() })}
              className="w-auto min-w-0 rounded border border-transparent bg-transparent px-1 font-display text-3xl font-black uppercase leading-none tracking-wide hover:border-rule focus:border-rule"
              aria-label="Slot name"
            />
          ) : (
            <h3 className="font-display text-3xl font-black uppercase leading-none tracking-wide">{slot.name}</h3>
          )}
          {ev.editable ? (
            <select value={slot.tier_label || ""} onChange={(e) => patch({ tier_label: e.target.value })} className="rounded border border-rule bg-paper px-1.5 py-0.5 text-xs" aria-label="Tier">
              <option value="">No tier</option>
              <option>Presenting</option>
              <option>Official</option>
              <option>Supporting</option>
            </select>
          ) : (
            slot.tier_label && <span className="rounded border border-rule px-1.5 py-0.5 text-xs">{slot.tier_label}</span>
          )}
          {slot.ranked_without_qloo_rank && <span className="text-xs text-stage">Ranked without Qloo head-to-head (data unavailable)</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ev.editable && (
            <Button variant={stale ? "primary" : "outline"} className="py-1.5 text-xs" onClick={rank} disabled={ranking || slot.candidates.filter((c) => !c.excluded_reason).length < 2} data-testid="rank-slot">
              {ranking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {slot.ranked_at ? "Re-rank" : "Rank"}
            </Button>
          )}
          {w && ev.editable && (
            <Button variant="outline" className="py-1.5 text-xs" onClick={() => onSaveWinner(w.qloo_entity_id)} data-testid="save-winner">
              <Star size={13} /> Save winner
            </Button>
          )}
          {w && (
            <Button
              variant="ghost"
              className="py-1.5 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(rationale);
                toast.success("Slot rationale copied");
              }}
            >
              <Copy size={13} /> Copy rationale
            </Button>
          )}
          {ev.editable && (
            <Button
              variant="ghost"
              className="py-1.5 text-xs"
              aria-label="Delete slot"
              onClick={async () => {
                await api(`/slots/${slot.id}`, { method: "DELETE" });
                onChanged();
                toast("Slot removed");
              }}
            >
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      </header>

      {ranking && (
        <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2 font-mono text-[11px]">
          <span className="live-dot" /> {log[log.length - 1] || "Asking Qloo for the head-to-head…"}
        </div>
      )}

      <div className="grid gap-6 p-4 lg:grid-cols-[1.1fr_1fr]">
        {/* podium */}
        <div>
          {rows.length < 2 ? (
            <Empty title="Needs two or more candidates">{ev.editable ? "Add brands below, then Rank." : "This slot has fewer than two candidates."}</Empty>
          ) : (
            <>
              <div className="grid grid-cols-[1.35fr_1fr_1fr] items-end gap-2">
                {[w, second, third].map((r, i) =>
                  r ? (
                    <div key={r.qloo_entity_id} className={cn("rounded-[5px] border border-rule p-3", i === 0 ? "bg-bulb" : "bg-paper-2")} data-testid={i === 0 ? "podium-winner" : undefined}>
                      <div className="flex items-center justify-between">
                        <span className="font-display text-xl font-black">#{i + 1}</span>
                        {i === 0 && <span className="rounded-[3px] bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bulb">{tooClose ? "Too close to call" : "Best pick"}</span>}
                      </div>
                      <BrandLogo name={r.name} src={r.logo_url} size={i === 0 ? 48 : 34} className="my-2" />
                      <p className={cn("name truncate leading-none", i === 0 ? "text-4xl" : "text-2xl")}>{r.name}</p>
                      <p className="mt-1 font-mono text-sm">{Math.round(r.lensScore)}</p>
                      {r.source === "user" && <p className="mt-1 text-[10px] uppercase tracking-wider text-slate">Added by you</p>}
                    </div>
                  ) : (
                    <div key={i} />
                  ),
                )}
              </div>
              {margin != null && (
                <p className="mt-3 text-sm">
                  {tooClose ? (
                    <>
                      <b>Too close to call</b> — {w.name} and {second.name} are within {margin} points. Deciding factors below.
                    </>
                  ) : (
                    <>
                      <b>{w.name}</b> leads by <b className="font-mono">{margin}</b> points.
                    </>
                  )}
                </p>
              )}
              {rows.length > 3 && (
                <ol className="mt-3 divide-y divide-rule rounded border border-rule text-sm" start={4}>
                  {rows.slice(3).map((r, i) => (
                    <li key={r.qloo_entity_id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="w-5 font-mono text-xs text-slate">#{i + 4}</span>
                      <BrandLogo name={r.name} src={r.logo_url} size={20} />
                      <span className="flex-1 truncate">{r.name}</span>
                      {r.source === "user" && <span className="text-[10px] text-slate">added by you</span>}
                      <span className="font-mono">{Math.round(r.lensScore)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>

        {/* head to head */}
        {w && second ? (
          <div className="rounded-[5px] border border-rule p-4" data-testid="head-to-head">
            <p className="mb-3 font-display text-xl font-extrabold uppercase">
              Why {w.name} over {second.name}
            </p>
            <div className="space-y-2">
              <MiniDiverge label="Head-to-head" a={w.rank_score} b={second.rank_score} aLabel={fmtTaste({ taste_rank: w.rank_position, taste_n: rows.length })} bLabel={fmtTaste({ taste_rank: second.rank_position, taste_n: rows.length })} />
              <MiniDiverge label="Overlap" a={w.metrics.overlap_shared} b={second.metrics.overlap_shared} aLabel={fmtOverlap(w.metrics)} bLabel={fmtOverlap(second.metrics)} />
              <MiniDiverge label="Local" a={w.metrics.local_top_pct} b={second.metrics.local_top_pct} aLabel={fmtLocal(w.metrics)} bLabel={fmtLocal(second.metrics)} higherBetter={false} />
              <MiniDiverge label="Momentum" a={w.metrics.momentum_pct} b={second.metrics.momentum_pct} aLabel={fmtMomentum(w.metrics)} bLabel={fmtMomentum(second.metrics)} />
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-rule pt-3 text-sm">
              {(slot.rationale?.bullets || []).map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                  <span>
                    {b.text} <SourceChip label={EVIDENCE_LABEL[b.evidence] || "Qloo"} />
                  </span>
                </li>
              ))}
              {!slot.rationale?.bullets?.length && <li className="text-slate">{w.name} doesn&apos;t lead on any single measured metric — the combined score decides.</li>}
            </ul>
            {lens !== "balanced" && <p className="mt-2 text-[10px] text-slate">Bullets were written for the Balanced lens; the order above follows your current lens.</p>}
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* candidates */}
      <div className="border-t border-rule px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate">Candidates ({slot.candidates.length}/8)</p>
        <div className="flex flex-wrap gap-1.5">
          {slot.candidates.map((c) => (
            <Tip key={c.qloo_entity_id} content={c.excluded_reason || (c.source === "user" ? "Added by you" : "Discovered for this crowd")}>
              <span className={cn("inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-xs", c.excluded_reason ? "border-dashed border-slate/50 text-slate line-through" : "border-rule")}>
                {c.name}
                {c.source === "user" && <span className="font-mono text-[9px] text-slate">YOU</span>}
                {ev.editable && (
                  <button aria-label={`Remove ${c.name}`} onClick={() => patch({ remove: [c.qloo_entity_id] })} className="text-slate hover:text-ink">
                    <X size={11} />
                  </button>
                )}
              </span>
            </Tip>
          ))}
        </div>
        {excluded.length > 0 && <p className="mt-1 text-[11px] text-slate">Greyed out: {excluded.map((c) => `${c.name} (${c.excluded_reason})`).join("; ")}</p>}
        {ev.editable && slot.candidates.length < 8 && (
          <div className="mt-3 max-w-md">
            <EntityPicker
              type="brand"
              placeholder="Add a brand, e.g. Pepsi"
              testId="slot-add-brand"
              onPick={async (p) => {
                await patch({ add: [{ qloo_entity_id: p.id, name: p.name, source: "user", logo_url: p.image }] });
                toast.success(`${p.name} added — re-rank to update`);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
