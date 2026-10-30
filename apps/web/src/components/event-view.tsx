"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Play, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import { fitScore } from "@/lib/scoring";
import type { EventFull } from "@/lib/types";
import { MarqueeSign } from "./marquee-sign";
import { ShortlistTab, useLens, useQueryState } from "./shortlist-tab";
import { SlotsTab } from "./slots-tab";
import { CrowdTab } from "./crowd-tab";
import { CheckTab } from "./check-tab";
import { LlmTab } from "./llm-tab";
import { Button, Glossary, HowMarqueeKnows, Skeleton } from "./ui";

const TABS = [
  { v: "shortlist", label: "Shortlist" },
  { v: "slots", label: "Sponsor slots" },
  { v: "crowd", label: "Crowd" },
  { v: "check", label: "Check a brand" },
  { v: "llm", label: "Compare vs LLM-only" },
];

export function useEvent(id: string) {
  return useQuery({ queryKey: ["event", id], queryFn: () => api<EventFull>(`/events/${id}`) });
}

export function EventView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: ev, isLoading, error } = useEvent(id);
  const lens = useLens();
  const { sp, set } = useQueryState();
  const tab = sp.get("tab") || "shortlist";
  const [how, setHow] = useState(false);
  const [gloss, setGloss] = useState(false);
  const [busy, setBusy] = useState(false);

  const ranked = useMemo(
    () => (ev?.matches || []).map((m) => ({ ...m, lensFit: fitScore(m.components, lens) })).sort((a, b) => (a.shelf === "local" ? 1 : 0) - (b.shelf === "local" ? 1 : 0) || b.lensFit - a.lensFit),
    [ev, lens],
  );
  const top3 = ranked.filter((b) => b.shelf !== "local" && !b.is_existing && !b.hidden).slice(0, 3).map((b) => b.name);

  if (isLoading) return <PageSkeleton />;
  if (error || !ev)
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="font-display text-4xl font-black uppercase">{error instanceof ApiError && error.status === 404 ? "Event not found" : "Couldn't load this event"}</p>
        <p className="mt-2 text-slate">{(error as Error)?.message}</p>
        <Link href="/portfolio" className="mt-6 inline-block underline">
          Back to the portfolio
        </Link>
      </div>
    );

  const duplicate = async () => {
    setBusy(true);
    try {
      const copy = await api<EventFull>(`/samples/${ev.id}/duplicate`, { method: "POST" });
      toast.success("Copied to your workspace — you can edit it now");
      router.push(`/events/${copy.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rerun = async () => {
    setBusy(true);
    try {
      const r = await api<{ run_id: string }>(`/events/${ev.id}/runs`, { method: "POST" });
      router.push(`/events/${ev.id}/runs/${r.run_id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  const saveWinner = async (qid: string) => {
    const m = ev.matches.find((x) => x.qloo_entity_id === qid);
    if (!m) {
      toast("That brand isn't in this run's shortlist yet — check it in “Check a brand” to add evidence.");
      return;
    }
    await api(`/matches/${m.id}`, { method: "PATCH", json: { saved: true } });
    qc.invalidateQueries({ queryKey: ["event", ev.id] });
    toast.success(`${m.name} saved to your shortlist`);
  };

  const lastRun = ev.last_run;
  const runningOther = lastRun && lastRun.status === "running" && lastRun.id !== ev.latest_run_id;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-28 pt-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate">
          <Link href="/portfolio" className="underline">
            Portfolio
          </Link>
          <span>/</span>
          <span className="text-ink">{ev.name}</span>
          {ev.is_sample && <span className="rounded border border-rule px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink">Demo scenario · read-only</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setHow(true)} className="underline decoration-dotted underline-offset-2">
            How Marquee knows
          </button>
          <button onClick={() => setGloss(true)} className="underline decoration-dotted underline-offset-2">
            Glossary
          </button>
        </div>
      </div>

      <MarqueeSign
        title={ev.name}
        subtitle={[ev.type_label, ev.city, ev.attendance ? `~${ev.attendance.toLocaleString()} fans` : null].filter(Boolean).join(" · ")}
        brands={top3}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate">Crowd signals:</span>
          {ev.crowd_signals
            .filter((s) => s.status === "resolved")
            .map((s) => (
              <span key={s.id} className="rounded border border-rule px-1.5 py-0.5">
                {s.display_name}
              </span>
            ))}
          {ev.existing_sponsors.length > 0 && <span className="ml-2 text-slate">Existing: {ev.existing_sponsors.join(", ")}</span>}
          {ev.exclude_categories.length > 0 && <span className="ml-2 text-slate">Excluding: {ev.exclude_categories.join(", ")}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {ev.latest_run_id && (
            <Link href={`/events/${ev.id}/runs/${ev.latest_run_id}`} className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule px-3 py-1.5 text-xs font-medium hover:bg-paper-2">
              View the agent run
            </Link>
          )}
          {ev.is_sample && !ev.editable ? (
            <Button onClick={duplicate} disabled={busy} className="py-1.5 text-xs" data-testid="duplicate">
              <Copy size={13} /> Duplicate to edit
            </Button>
          ) : (
            <Button onClick={rerun} disabled={busy} className="py-1.5 text-xs">
              <Play size={13} /> Re-run live
            </Button>
          )}
        </div>
      </div>
      {ev.is_sample && <p className="mt-2 text-[11px] text-slate">Demo scenario: fictional events with real performers, teams and brands as taste signals. Not affiliated with Live Nation or any performer, team or brand shown.</p>}
      {runningOther && (
        <Link href={`/events/${ev.id}/runs/${lastRun.id}`} className="mt-3 flex items-center gap-2 rounded border border-rule bg-bulb-soft px-3 py-2 text-sm">
          <span className="live-dot" /> A live run is in progress — watch the Soundcheck
        </Link>
      )}
      {lastRun && (lastRun.status === "interrupted" || lastRun.status === "error") && lastRun.id !== ev.latest_run_id && (
        <p className="mt-3 rounded border border-stage/50 bg-stage/5 px-3 py-2 text-sm">
          The last run {lastRun.status === "interrupted" ? "was interrupted — re-run" : `failed: ${lastRun.error}`}. {ev.editable && <button className="underline" onClick={rerun}>Re-run live</button>}
        </p>
      )}

      {!ev.latest_run_id ? (
        <div className="mt-10 rounded-md border border-dashed border-rule p-10 text-center">
          <p className="font-display text-3xl font-black uppercase">The board is dark</p>
          <p className="mt-1 text-slate">Run discovery to read your crowd and light up the shortlist.</p>
          {ev.editable && (
            <Button className="mt-4" onClick={rerun} disabled={busy}>
              <Play size={14} /> Find my sponsors
            </Button>
          )}
        </div>
      ) : (
        <Tabs.Root value={tab} onValueChange={(v) => set({ tab: v === "shortlist" ? null : v })} className="mt-6">
          <Tabs.List className="mb-6 flex gap-0 overflow-x-auto border-b border-rule" aria-label="Event views">
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.v}
                value={t.v}
                className={cn(
                  "relative -mb-px whitespace-nowrap border border-transparent px-4 py-2.5 font-display text-lg font-bold uppercase tracking-wide transition-colors",
                  "data-[state=active]:rounded-t-[5px] data-[state=active]:border-rule data-[state=active]:border-b-paper data-[state=active]:bg-paper",
                  "data-[state=inactive]:text-slate data-[state=inactive]:hover:text-ink",
                )}
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="shortlist">
            <ShortlistTab ev={ev} ranked={ranked} />
          </Tabs.Content>
          <Tabs.Content value="slots">
            <SlotsTab ev={ev} lens={lens} onSaveWinner={saveWinner} />
          </Tabs.Content>
          <Tabs.Content value="crowd">
            <CrowdTab ev={ev} />
          </Tabs.Content>
          <Tabs.Content value="check">
            <CheckTab ev={ev} lens={lens} />
          </Tabs.Content>
          <Tabs.Content value="llm">
            <LlmTab ev={ev} ranked={ranked} />
          </Tabs.Content>
        </Tabs.Root>
      )}
      <CoachMarks show={!!ev.latest_run_id} />
      <HowMarqueeKnows open={how} onOpenChange={setHow} />
      <Glossary open={gloss} onOpenChange={setGloss} />
    </div>
  );
}

function CoachMarks({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      setVisible(show && localStorage.getItem("marquee.coach") !== "done");
    } catch {
      setVisible(false);
    }
  }, [show]);
  if (!visible) return null;
  const dismiss = () => {
    try {
      localStorage.setItem("marquee.coach", "done");
    } catch {}
    setVisible(false);
  };
  const steps = ["These are the brands your crowd loves", "Pick one winner per category in Sponsor slots", "Save and export your shortlist"];
  return (
    <div className="fixed bottom-20 right-4 z-40 w-[300px] rounded-md border border-rule bg-paper p-4 no-print" role="dialog" aria-label="Quick guide">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-xl font-black uppercase">Quick guide</p>
        <button onClick={dismiss} aria-label="Dismiss guide" className="rounded p-1 hover:bg-paper-2">
          <X size={14} />
        </button>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2.5 text-sm">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink font-mono text-[10px] text-bulb">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <Button className="mt-3 w-full py-1.5 text-xs" onClick={dismiss}>
        Got it
      </Button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1320px] space-y-6 px-4 pt-6 sm:px-6">
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-10 w-1/2" />
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
    </div>
  );
}
