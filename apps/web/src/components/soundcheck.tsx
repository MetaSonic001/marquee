"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, streamSSE } from "@/lib/api";
import { cn } from "@/lib/format";
import type { RunEvt } from "@/lib/types";
import { useEvent } from "./event-view";
import { BrandLogo, Button, ToolBadge } from "./ui";

const STAGES = [
  "Understanding your event",
  "Matching your lineup in Qloo",
  "Reading your crowd's taste",
  "Discovering brands",
  "Measuring audience overlap",
  "Checking local strength and momentum",
  "Researching sponsor activity on the web",
  "Building your shortlist",
];

type StageState = { status: "pending" | "running" | "done"; start?: number; end?: number; tools: Record<string, number>; summary?: string; last?: string };

export function Soundcheck({ eventId, runId }: { eventId: string; runId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const { data: ev } = useEvent(eventId);
  const [stages, setStages] = useState<StageState[]>(() => STAGES.map(() => ({ status: "pending", tools: {} })));
  const [brands, setBrands] = useState<{ id: string; name: string; image?: string }[]>([]);
  const [domains, setDomains] = useState<{ domain: string; items: { name: string; affinity?: number }[] }[]>([]);
  const [feed, setFeed] = useState<RunEvt[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [clock, setClock] = useState(0);
  const [t0, setT0] = useState<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const queue: RunEvt[] = [];
    let replaying = false;
    let playing = false;
    // A finished run replays from storage. Play it back at a watchable pace (stage timings stay real).
    const play = async () => {
      if (playing) return;
      playing = true;
      while (queue.length && !ctl.signal.aborted) {
        const e = queue.shift()!;
        apply(e);
        if (replaying) await new Promise((r) => setTimeout(r, e.kind === "stage_done" ? 380 : e.kind === "partial" ? 70 : 45));
      }
      playing = false;
    };
    fetch(`${API_BASE}/runs/${runId}`)
      .then((r) => r.json())
      .then((r: { status?: string }) => {
        if (r.status && r.status !== "running") {
          replaying = true;
          setReplay(true);
        }
      })
      .catch(() => {})
      .finally(() =>
        streamSSE(
          `/runs/${runId}/stream`,
          (e) => {
            queue.push(e);
            play();
          },
          { signal: ctl.signal, reconnect: true },
        ).catch((err) => setError((err as Error).message)),
      );

    function apply(e: RunEvt) {
        const ts = e.ts ? e.ts * 1000 : Date.now();
        setClock(ts);
        setT0((v) => (v === null ? ts : v));
        setFeed((f) => [...f.slice(-60), e]);
        if (e.kind === "error") setError(e.summary);
        if (e.kind === "done") setDone(e.summary);
        if (e.kind === "partial") {
          const d = e.data as { brand?: { id: string; name: string; image?: string }; fingerprint_domain?: string; items?: { name: string; affinity?: number }[] } | undefined;
          if (d?.brand) setBrands((b) => (b.find((x) => x.id === d.brand!.id) ? b : [...b, d.brand!]));
          if (d?.fingerprint_domain) setDomains((x) => [...x.filter((y) => y.domain !== d.fingerprint_domain), { domain: d.fingerprint_domain!, items: d.items || [] }]);
        }
        const i = e.stage - 1;
        if (i < 0 || i > 7) return;
        setStages((prev) => {
          const next = prev.map((s) => ({ ...s, tools: { ...s.tools } }));
          const s = next[i];
          if (e.kind === "stage_start") {
            s.status = "running";
            s.start = ts;
          } else if (e.kind === "stage_done") {
            s.status = "done";
            s.end = ts;
            s.summary = e.summary;
          } else if (e.kind === "tool_call" && e.tool) {
            s.tools[e.tool] = (s.tools[e.tool] || 0) + 1;
            s.last = e.summary;
            if (s.status === "pending") {
              s.status = "running";
              s.start = ts;
            }
          } else if (e.kind === "insight") s.last = e.summary;
          return next;
        });
    }
    return () => ctl.abort();
  }, [runId]);

  useEffect(() => {
    if (done) qc.invalidateQueries({ queryKey: ["event", eventId] });
  }, [done, eventId, qc]);

  const ref = replay ? clock : now;
  const elapsed = (s: StageState) => (s.start ? (Math.max(0, (s.end ?? ref) - s.start) / 1000).toFixed(1) + "s" : "");
  const total = t0 ? Math.max(0, Math.round(((done ? stages[7].end ?? ref : ref) - t0) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate">
            {done ? <span className="h-2 w-2 rounded-full bg-moss" /> : error ? <span className="h-2 w-2 rounded-full bg-stage" /> : <span className="live-dot" />}
            {done ? (replay ? "Stored run · replayed" : "Run complete") : error ? "Run stopped" : "Live · Soundcheck"}
          </p>
          <h1 className="font-display text-5xl font-black uppercase leading-none tracking-wide sm:text-6xl">{ev?.name || "Soundcheck"}</h1>
          <p className="mt-1 text-sm text-slate">The agent is reading your crowd with Qloo. Every badge is a real tool call.</p>
        </div>
        <div className="text-right">
          <p className="font-display text-5xl font-black tabular">{total}s</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate">elapsed</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* timeline */}
        <ol className="relative rounded-md border border-rule bg-paper" aria-live="polite">
          {stages.map((s, i) => (
            <li key={i} className={cn("grid grid-cols-[44px_1fr_auto] gap-3 border-b border-rule px-4 py-3.5 last:border-b-0", s.status === "running" && "bg-bulb-soft/40")}>
              <div className={cn("grid h-8 w-8 place-items-center rounded-full border font-display text-base font-black", s.status === "done" ? "border-rule bg-ink text-bulb" : s.status === "running" ? "border-rule bg-bulb" : "border-rule text-slate")}>
                {s.status === "done" ? <Check size={15} /> : s.status === "running" ? <Loader2 size={15} className="animate-spin" /> : i + 1}
              </div>
              <div className="min-w-0">
                <p className={cn("font-display text-xl font-extrabold uppercase leading-tight tracking-wide", s.status === "pending" && "text-slate")}>{STAGES[i]}</p>
                {Object.keys(s.tools).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(s.tools).map(([t, n]) => (
                      <ToolBadge key={t} tool={`${t}${n > 1 ? ` ×${n}` : ""}`} />
                    ))}
                  </div>
                )}
                {(s.summary || s.last) && <p className={cn("mt-1 text-sm", s.status === "done" ? "text-ink" : "text-slate")}>{s.summary || s.last}</p>}
              </div>
              <span className="font-mono text-xs text-slate">{elapsed(s)}</span>
            </li>
          ))}
        </ol>

        {/* live results */}
        <div className="space-y-5">
          <section className="rounded-md border border-rule bg-night p-4 text-ink">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-bulb">Taste fingerprint</p>
            {domains.length === 0 ? (
              <p className="text-sm text-ink/50">Waiting for Qloo…</p>
            ) : (
              <div className="space-y-2">
                {domains.map((d) => (
                  <motion.div key={d.domain} initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="grid grid-cols-[72px_1fr] gap-2 text-xs">
                    <span className="font-mono uppercase text-ink/60">{d.domain}</span>
                    <span className="flex flex-wrap gap-1">
                      {d.items.slice(0, 5).map((it) => (
                        <span key={it.name} className="rounded-[3px] bg-white/10 px-1.5 py-0.5">
                          {it.name}
                        </span>
                      ))}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-md border border-rule bg-paper p-4">
            <p className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-slate">
              Discovered tray <span className="text-ink">{brands.length}</span>
            </p>
            <div className="flex min-h-[120px] flex-wrap content-start gap-2">
              <AnimatePresence>
                {brands.map((b) => (
                  <motion.div key={b.id} initial={reduce ? false : { opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex items-center gap-1.5 rounded border border-rule bg-paper py-0.5 pl-0.5 pr-2 text-xs" title={b.name}>
                    <BrandLogo name={b.name} src={b.image} size={22} />
                    {b.name}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
          <section className="max-h-56 overflow-y-auto rounded-md border border-rule bg-paper-2/60 p-3 font-mono text-[11px]" aria-label="Agent log">
            {feed
              .filter((e) => e.kind === "tool_call" || e.kind === "insight")
              .slice(-14)
              .map((e) => (
                <p key={e.seq} className="truncate">
                  <span className="text-slate">{String(e.seq).padStart(3, "0")}</span> {e.tool ? <b>{e.tool}</b> : "·"} {e.summary}
                </p>
              ))}
          </section>
          {done && (
            <div className="rounded-md border border-rule bg-bulb p-4">
              <p className="font-display text-2xl font-black uppercase">{done}</p>
              <Button className="mt-3" onClick={() => router.push(`/events/${eventId}`)}>
                Open the shortlist →
              </Button>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-stage bg-stage/5 p-4 text-sm">
              <p className="font-semibold">The run stopped: {error}</p>
              <p className="mt-1 text-slate">Nothing was guessed — stored results (if any) are unchanged.</p>
              <Link href={`/events/${eventId}`} className="mt-2 inline-block underline">
                Back to the event
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
