"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ArrowUpDown, Download, FileText, LayoutGrid, Rows3, SlidersHorizontal, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { api, downloadCsv } from "@/lib/api";
import { cn, fmtLocal, fmtMomentum, fmtOverlap, fmtTaste, SHELF_COPY, talkingPoints } from "@/lib/format";
import { COMPONENTS, COMPONENT_LABELS, LENSES, LENS_LABELS, fitScore, isLens } from "@/lib/scoring";
import type { Lens } from "@/lib/scoring";
import type { BrandMatch, EventFull } from "@/lib/types";
import { BrandCard, FitNumber, MetricsRow } from "./brand-card";
import { BrandDrawer } from "./brand-drawer";
import { BrandLogo, Button, Empty, Modal, Tip } from "./ui";

export function useLens(): Lens {
  const sp = useSearchParams();
  const l = sp.get("lens");
  return isLens(l) ? l : "balanced";
}

export function useQueryState() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };
  return { sp, set };
}

export function LensControl({ lens, onChange }: { lens: Lens; onChange: (l: Lens) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Ranking lens" className="flex flex-wrap rounded-[5px] border border-rule bg-paper p-[3px]">
        {(Object.keys(LENSES) as Lens[]).map((l) => (
          <button
            key={l}
            role="radio"
            aria-checked={lens === l}
            onClick={() => onChange(l)}
            className={cn("rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors", lens === l ? "bg-ink text-paper" : "hover:bg-paper-2")}
          >
            {LENS_LABELS[l]}
          </button>
        ))}
      </div>
      <Popover.Root>
        <Popover.Trigger className="rounded px-1.5 py-1 font-mono text-[11px] underline decoration-dotted underline-offset-2 hover:bg-paper-2">weights</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} className="z-[70] w-64 rounded-md border border-rule bg-paper p-3 shadow-xl">
            <p className="mb-2 font-display text-lg font-extrabold uppercase">{LENS_LABELS[lens]}</p>
            {COMPONENTS.map((k) => (
              <div key={k} className="mb-1 grid grid-cols-[1fr_80px_32px] items-center gap-2 text-xs">
                <span>{COMPONENT_LABELS[k]}</span>
                <span className="h-2 rounded bg-paper-3">
                  <span className="block h-full rounded bg-ink" style={{ width: `${LENSES[lens][k] * 2}%` }} />
                </span>
                <span className="text-right font-mono">{LENSES[lens][k]}</span>
              </div>
            ))}
            <p className="mt-2 text-[10px] text-slate">Re-weights stored Qloo components instantly — no new API calls.</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function ShortlistTab({ ev, ranked }: { ev: EventFull; ranked: (BrandMatch & { lensFit: number })[] }) {
  const qc = useQueryClient();
  const { sp, set } = useQueryState();
  const lens = useLens();
  const view = sp.get("view") === "table" ? "table" : "cards";
  const cat = sp.get("cat") || "";
  const shelfF = sp.get("shelf") || "";
  const sponsorsOnly = sp.get("sponsors") === "1";
  const ppOnly = sp.get("pp") === "1";
  const minFit = Number(sp.get("min") || 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string>("fit");
  const [animateIn, setAnimateIn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setAnimateIn(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const visible = ranked.filter(
    (b) =>
      !b.hidden &&
      (!cat || b.category_key === cat) &&
      (!shelfF || b.shelf === shelfF) &&
      (!sponsorsOnly || (b.sponsor_activity?.count ?? 0) > 0) &&
      (!ppOnly || !!b.start_here?.partnerships_page) &&
      b.lensFit >= minFit,
  );
  const cats = useMemo(() => Array.from(new Map(ranked.map((b) => [b.category_key, b.category])).entries()), [ranked]);
  const saved = ranked.filter((b) => b.saved);
  const openB = ranked.find((b) => b.id === openId) || null;

  const patch = async (b: BrandMatch, body: { saved?: boolean; hidden?: boolean }) => {
    qc.setQueryData<EventFull>(["event", ev.id], (old) => (old ? { ...old, matches: old.matches.map((m) => (m.id === b.id ? { ...m, ...body } : m)) } : old));
    try {
      await api(`/matches/${b.id}`, { method: "PATCH", json: body });
    } catch (e) {
      toast.error((e as Error).message);
      qc.invalidateQueries({ queryKey: ["event", ev.id] });
    }
  };
  const hide = (b: BrandMatch) => {
    patch(b, { hidden: true });
    toast(`${b.name} hidden`, { action: { label: "Undo", onClick: () => patch(b, { hidden: false }) } });
  };

  const exportQuery = () => {
    const q = new URLSearchParams({ lens });
    if (shelfF) q.set("shelf", shelfF);
    if (cat) q.set("category", cat);
    if (minFit) q.set("min_fit", String(minFit));
    return q;
  };

  const shelves = (["natural", "hidden", "local"] as const).map((s) => ({ key: s, items: visible.filter((b) => b.shelf === s) })).filter((s) => s.items.length);

  if (!ranked.length) return <Empty title="No shortlist yet">Run discovery to fill the board.</Empty>;

  return (
    <div>
      {/* control bar */}
      <div className="sticky top-14 z-30 -mx-4 mb-6 border-y border-rule bg-paper/95 px-4 py-2.5 backdrop-blur-[2px] sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LensControl lens={lens} onChange={(l) => set({ lens: l === "balanced" ? null : l })} />
          <div className="flex flex-wrap items-center gap-2">
            <Popover.Root>
              <Popover.Trigger className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule px-2.5 py-1.5 text-xs font-medium hover:bg-paper-2">
                <SlidersHorizontal size={13} /> Filters
                {(cat || shelfF || sponsorsOnly || ppOnly || minFit > 0) && <span className="rounded bg-bulb px-1 font-mono text-[10px]">on</span>}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content sideOffset={6} align="end" className="z-[70] w-72 space-y-3 rounded-md border border-rule bg-paper p-4 text-sm shadow-xl">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">Category</span>
                    <select className="w-full rounded border border-rule bg-paper px-2 py-1.5" value={cat} onChange={(e) => set({ cat: e.target.value || null })}>
                      <option value="">All categories</option>
                      {cats.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">Shelf</span>
                    <select className="w-full rounded border border-rule bg-paper px-2 py-1.5" value={shelfF} onChange={(e) => set({ shelf: e.target.value || null })}>
                      <option value="">All shelves</option>
                      <option value="natural">Natural fits</option>
                      <option value="hidden">Hidden gems</option>
                      <option value="local">Local heroes</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-ink" checked={sponsorsOnly} onChange={(e) => set({ sponsors: e.target.checked ? "1" : null })} /> Already sponsors events
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-ink" checked={ppOnly} onChange={(e) => set({ pp: e.target.checked ? "1" : null })} /> Has partnerships page
                  </label>
                  <label className="block">
                    <span className="mb-1 flex justify-between text-xs font-medium">
                      Minimum fit <span className="font-mono">{minFit}</span>
                    </span>
                    <input type="range" min={0} max={90} step={5} value={minFit} onChange={(e) => set({ min: e.target.value === "0" ? null : e.target.value })} className="w-full accent-ink" aria-label="Minimum fit" />
                  </label>
                  <button className="text-xs underline" onClick={() => set({ cat: null, shelf: null, sponsors: null, pp: null, min: null })}>
                    Clear filters
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <div className="flex rounded-[5px] border border-rule p-[2px]" role="radiogroup" aria-label="View">
              <button role="radio" aria-checked={view === "cards"} onClick={() => set({ view: null })} className={cn("rounded-[3px] p-1.5", view === "cards" && "bg-ink text-paper")} aria-label="Cards view">
                <LayoutGrid size={14} />
              </button>
              <button role="radio" aria-checked={view === "table"} onClick={() => set({ view: "table" })} className={cn("rounded-[3px] p-1.5", view === "table" && "bg-ink text-paper")} aria-label="Table view">
                <Rows3 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {visible.length === 0 && <Empty title="Nothing matches these filters">Loosen a filter or lower the minimum fit.</Empty>}

      {view === "cards" ? (
        <div className="space-y-12">
          {shelves.map((s) => (
            <section key={s.key} aria-labelledby={`shelf-${s.key}`}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-2">
                <div>
                  <h2 id={`shelf-${s.key}`} className="font-display text-[40px] font-black uppercase leading-none tracking-wide">
                    {SHELF_COPY[s.key].title} <span className="align-top font-mono text-sm font-normal text-slate">{s.items.length}</span>
                  </h2>
                  <p className="text-sm text-slate">{SHELF_COPY[s.key].blurb(ev.type_label)}</p>
                </div>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {s.items.map((b) => (
                  <BrandCard
                    key={b.id}
                    b={b}
                    fit={b.lensFit}
                    lens={lens}
                    index={ranked.indexOf(b)}
                    eventName={ev.name}
                    editable={ev.editable}
                    onOpen={() => setOpenId(b.id)}
                    onSave={() => patch(b, { saved: !b.saved })}
                    onHide={() => hide(b)}
                    compareChecked={compare.includes(b.id)}
                    onCompare={(v) => setCompare((c) => (v ? [...c.filter((x) => x !== b.id), b.id].slice(-3) : c.filter((x) => x !== b.id)))}
                    animateIn={animateIn}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <BrandTable rows={visible} sortKey={sortKey} setSortKey={setSortKey} onOpen={setOpenId} />
      )}

      {/* compare tray */}
      {compare.length > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-rule bg-paper px-3 py-2 no-print">
          <span className="text-xs font-medium">Compare</span>
          {compare.map((id) => {
            const b = ranked.find((x) => x.id === id);
            return b ? (
              <span key={id} className="flex items-center gap-1 rounded border border-rule px-1.5 py-0.5 text-xs">
                {b.name}
                <button onClick={() => setCompare((c) => c.filter((x) => x !== id))} aria-label={`Remove ${b.name} from compare`}>
                  <X size={12} />
                </button>
              </span>
            ) : null;
          })}
          <Button className="py-1 text-xs" disabled={compare.length < 2} onClick={() => setCompareOpen(true)}>
            Compare {compare.length}
          </Button>
        </div>
      )}
      <Modal open={compareOpen} onOpenChange={setCompareOpen} title="Side by side" wide>
        <CompareGrid brands={compare.map((id) => ranked.find((b) => b.id === id)!).filter(Boolean)} />
      </Modal>

      {/* saved bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-night text-ink no-print">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          <p className="text-sm">
            <span className="font-display text-2xl font-black text-bulb tabular" data-testid="saved-count">
              {saved.length}
            </span>{" "}
            brands saved
            <span className="ml-2 hidden text-xs text-ink/60 sm:inline">Exports follow the current lens &amp; filters.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="dark"
              className="border-bulb/40 py-1.5 text-xs"
              onClick={async () => {
                try {
                  await downloadCsv(ev.id, exportQuery().toString(), `marquee_${ev.name.replace(/\W+/g, "_")}.csv`);
                  toast.success("CSV exported");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Download size={13} /> Export CSV
            </Button>
            <a
              href={`/events/${ev.id}/report?${exportQuery().toString()}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-bulb/40 bg-night px-3 py-1.5 text-xs font-medium text-bulb hover:bg-ink"
            >
              <FileText size={13} /> PDF report
            </a>
            <Button
              variant="dark"
              className="border-bulb/40 py-1.5 text-xs"
              onClick={() => {
                const list = saved.length ? saved : visible.slice(0, 10);
                navigator.clipboard.writeText(list.map((b) => talkingPoints(b, b.lensFit, ev.name)).join("\n\n"));
                toast.success(`Talking points for ${list.length} brands copied`);
              }}
            >
              <Copy size={13} /> Copy all talking points
            </Button>
          </div>
        </div>
      </div>
      <BrandDrawer b={openB} lens={lens} open={!!openB} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}

function BrandTable({ rows, sortKey, setSortKey, onOpen }: { rows: (BrandMatch & { lensFit: number })[]; sortKey: string; setSortKey: (k: string) => void; onOpen: (id: string) => void }) {
  const val = (b: BrandMatch & { lensFit: number }, k: string): number => {
    const m = b.metrics;
    switch (k) {
      case "taste":
        return m.taste_rank ? -m.taste_rank : -999;
      case "overlap":
        return m.overlap_shared ?? -1;
      case "local":
        return m.local_top_pct != null ? -m.local_top_pct : -999;
      case "momentum":
        return m.momentum_pct ?? -999;
      case "sponsor":
        return b.sponsor_activity?.count ?? -1;
      default:
        return b.lensFit;
    }
  };
  const sorted = [...rows].sort((a, b) => val(b, sortKey) - val(a, sortKey));
  const H = SortHeader;
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-paper-2 text-[10px] tracking-wider text-slate">
          <tr>
            <th className="px-3 py-2 text-left uppercase">Brand</th>
            <th className="px-2 py-2 text-left uppercase">Shelf</th>
            <H k="fit" active={sortKey} onSort={setSortKey}>Fit</H>
            <H k="taste" active={sortKey} onSort={setSortKey}>Taste</H>
            <H k="overlap" active={sortKey} onSort={setSortKey}>Overlap</H>
            <H k="local" active={sortKey} onSort={setSortKey}>Local</H>
            <H k="momentum" active={sortKey} onSort={setSortKey}>Momentum</H>
            <H k="sponsor" active={sortKey} onSort={setSortKey}>Sponsor</H>
          </tr>
        </thead>
        <tbody className="font-mono text-[13px]">
          {sorted.map((b) => (
            <tr key={b.id} className="cursor-pointer border-t border-rule hover:bg-bulb-soft/40" onClick={() => onOpen(b.id)}>
              <td className="px-3 py-2 font-sans">
                <span className="flex items-center gap-2">
                  <BrandLogo name={b.name} src={b.logo_url} size={24} />
                  <b>{b.name}</b> <span className="text-xs text-slate">{b.category}</span>
                </span>
              </td>
              <td className="px-2 font-sans text-xs">{b.shelf}</td>
              <td className="px-2 font-bold">{Math.round(b.lensFit)}</td>
              <td className="px-2">{fmtTaste(b.metrics)}</td>
              <td className="px-2">{fmtOverlap(b.metrics)}</td>
              <td className="px-2">{fmtLocal(b.metrics)}</td>
              <td className="px-2">{fmtMomentum(b.metrics)}</td>
              <td className="px-2">{b.sponsor_activity?.count ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({ k, active, onSort, children }: { k: string; active: string; onSort: (k: string) => void; children: React.ReactNode }) {
  return (
    <th className="px-2 py-2 text-left">
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 uppercase", active === k && "text-ink underline")}>
        {children} <ArrowUpDown size={10} />
      </button>
    </th>
  );
}

export function CompareGrid({ brands, lens = "balanced" }: { brands: BrandMatch[]; lens?: Lens }) {
  return (
    <div className={cn("grid gap-4", brands.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
      {brands.map((b) => (
        <div key={b.id} className="rounded-md border border-rule p-3">
          <div className="mb-2 flex items-center gap-2">
            <BrandLogo name={b.name} src={b.logo_url} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-2xl font-extrabold uppercase leading-none">{b.name}</p>
              <p className="text-xs text-slate">{b.category}</p>
            </div>
            <FitNumber fit={fitScore(b.components, lens)} size="sm" />
          </div>
          <MetricsRow m={b.metrics} />
          <ul className="mt-2 space-y-1 text-xs">
            {b.why.slice(0, 2).map((w, i) => (
              <li key={i}>• {w.text}</li>
            ))}
          </ul>
          <Tip content={b.sponsor_activity?.summary || ""}>
            <p className="mt-2 truncate text-xs text-slate">{b.sponsor_activity?.summary}</p>
          </Tip>
        </div>
      ))}
    </div>
  );
}
