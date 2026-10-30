"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/format";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&.-";

/** One row of split-flap tiles. Each tile riffles through glyphs before settling, left to right. */
export function FlapRow({ text, width, lit, size = 28, delay = 0 }: { text: string; width: number; lit?: boolean; size?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const target = text.toUpperCase().replace(/[^A-Z0-9&.\- ]/g, "").slice(0, width).padEnd(width, " ");
  const [shown, setShown] = useState(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setShown(target);
      return;
    }
    const start = performance.now() + delay;
    const settleAt = Array.from(target).map((_, i) => 260 + i * 38 + Math.random() * 120);
    const tick = (t: number) => {
      const el = t - start;
      if (el < 0) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      let done = true;
      const out = Array.from(target).map((ch, i) => {
        if (el >= settleAt[i]) return ch;
        done = false;
        return GLYPHS[Math.floor((el / 45 + i * 7) % GLYPHS.length)];
      });
      setShown(out.join(""));
      if (!done) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, reduce, delay]);

  return (
    <div className="flex" style={{ fontSize: size }} aria-hidden>
      {Array.from(shown).map((ch, i) => (
        <span key={i} className={cn("flap", ch === " " && "space", lit && ch !== " " && "lit")}>
          {ch === " " ? "" : ch}
        </span>
      ))}
    </div>
  );
}

/** The "Now showing" departure board: event name plus its top brands, flipped in on load. */
export function MarqueeSign({ title, subtitle, brands, label = "Now showing", compact }: { title: string; subtitle?: string; brands: string[]; label?: string; compact?: boolean }) {
  const [w, setW] = useState(16);
  const ref = useRef<HTMLDivElement>(null);
  const tile = compact ? 20 : 28;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(8, Math.min(22, Math.floor((el.clientWidth - 36) / (tile * 0.85))))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tile]);
  const rows = brands.length ? brands.slice(0, 3) : ["- - -"];
  return (
    <section className="flap-board overflow-hidden" aria-label={`${title}. ${label}: ${brands.join(", ") || "not yet run"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-slate">
        <span className="flex items-center gap-2">
          <span className="live-dot" /> {label}
        </span>
        {subtitle && <span className="truncate">{subtitle}</span>}
      </div>
      <div className={cn("grid gap-6 px-5 sm:px-7", compact ? "py-5" : "py-7 lg:grid-cols-[1fr_minmax(0,1.05fr)] lg:items-end")}>
        <h1 className={cn("font-display leading-[0.92] text-ink", compact ? "text-3xl" : "text-[40px] sm:text-[60px] lg:text-[68px]")}>{title}</h1>
        <div ref={ref} className="min-w-0 space-y-[6px]">
          <div className="mb-1 grid grid-cols-[28px_1fr] font-mono text-[9px] uppercase tracking-[0.2em] text-slate">
            <span>No.</span>
            <span>Sponsor · ranked by Marquee Fit</span>
          </div>
          {rows.map((b, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr] items-center">
              <span className="font-mono text-xs text-bulb">0{i + 1}</span>
              <FlapRow text={b} width={w} lit={i === 0} size={tile} delay={i * 180} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
