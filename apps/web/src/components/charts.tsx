"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { Overlap, Trend } from "@/lib/types";

/** Two circles whose intersection area is proportional to the measured overlap ratio. */
export function OverlapDisc({ overlap, brand, size = 220 }: { overlap: Overlap; brand: string; size?: number }) {
  const ratio = overlap.available ? Math.max(0, Math.min(1, overlap.ratio ?? 0)) : 0;
  const r = size * 0.28;
  // circle-circle intersection area as a function of distance; solve for d by bisection
  const area = (d: number) => {
    if (d >= 2 * r) return 0;
    return 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
  };
  const target = ratio * Math.PI * r * r;
  let lo = 0;
  let hi = 2 * r;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (area(mid) > target) lo = mid;
    else hi = mid;
  }
  const d = (lo + hi) / 2;
  const cy = size * 0.42;
  const cx1 = size / 2 - d / 2;
  const cx2 = size / 2 + d / 2;
  return (
    <figure className="flex flex-col items-center">
      <svg width={size} height={size * 0.84} viewBox={`0 0 ${size} ${size * 0.84}`} role="img" aria-label={`Overlap disc: ${overlap.shared_count ?? 0} of ${overlap.of ?? 20} tastes shared between your crowd and ${brand} fans`}>
        <defs>
          <clipPath id="clipA">
            <circle cx={cx1} cy={cy} r={r} />
          </clipPath>
        </defs>
        <circle cx={cx1} cy={cy} r={r} fill="#232327" stroke="#EEE9E0" strokeWidth={1.2} />
        <circle cx={cx2} cy={cy} r={r} fill="#232327" fillOpacity={0.6} stroke="#EEE9E0" strokeWidth={1.2} />
        <circle cx={cx2} cy={cy} r={r} fill="#FF5A1F" clipPath="url(#clipA)" />
        <circle cx={cx1} cy={cy} r={r} fill="none" stroke="#EEE9E0" strokeWidth={1.2} />
        <circle cx={cx2} cy={cy} r={r} fill="none" stroke="#EEE9E0" strokeWidth={1.2} />
        <text fill="#EEE9E0" x={cx1 - r * 0.45} y={cy + 4} textAnchor="middle" className="font-display" fontSize={14} fontWeight={800}>
          CROWD
        </text>
        <text fill="#EEE9E0" x={cx2 + r * 0.45} y={cy + 4} textAnchor="middle" className="font-display" fontSize={14} fontWeight={800}>
          {brand.length > 10 ? brand.slice(0, 9) + "…" : brand.toUpperCase()}
        </text>
        <text fill="#EEE9E0" x={size / 2} y={cy + r + 26} textAnchor="middle" fontFamily="var(--font-jetbrains)" fontSize={12}>
          {overlap.available ? `${overlap.shared_count} of ${overlap.of} tastes shared` : "overlap n/a"}
        </text>
      </svg>
    </figure>
  );
}

export function Sparkline({ trend, height = 56 }: { trend: Trend; height?: number }) {
  const data = (trend.series || []).map((p) => ({ d: p.d, v: Math.round(p.v * 1000) / 10 }));
  if (data.length < 2) return <p className="font-mono text-xs text-slate">Trend n/a — Qloo returned no series for this brand.</p>;
  const up = (trend.rel_change ?? 0) >= 0;
  const color = up ? "#5AD19A" : "#F2C14E";
  return (
    <div style={{ height }} aria-label={`12-month Qloo popularity percentile, ${up ? "up" : "down"} ${Math.abs((trend.rel_change ?? 0) * 100).toFixed(1)}%`} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.35} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="d" hide />
          <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
          <RTooltip
            contentStyle={{ background: "#1c1c1f", border: "1px solid rgba(238,233,224,.12)", borderRadius: 6, color: "#EEE9E0", fontSize: 11, fontFamily: "var(--font-jetbrains)" }}
            formatter={(v) => [`${v} pctl`, "Qloo popularity"]}
            labelStyle={{ color: "#FF5A1F" }}
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill="url(#sg)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Crowd vs brand-fans tag profile (counts from qloo_compare_audiences), diverging around the centre. */
export function DivergingTags({ overlap, brand }: { overlap: Overlap; brand: string }) {
  const crowd = new Map((overlap.crowd_top || []).map((t) => [t.tag_id, t]));
  const fans = new Map((overlap.brand_top || []).map((t) => [t.tag_id, t]));
  const ids = Array.from(new Set([...(overlap.shared || []).map((s) => s.tag_id), ...Array.from(crowd.keys()).slice(0, 5), ...Array.from(fans.keys()).slice(0, 5)])).slice(0, 12);
  const max = Math.max(1, ...ids.map((i) => Math.max(crowd.get(i)?.count ?? 0, fans.get(i)?.count ?? 0)));
  if (!ids.length) return null;
  return (
    <div className="space-y-[3px]" role="table" aria-label={`Tag profile: your crowd vs ${brand} fans`}>
      <div className="mb-1 grid grid-cols-[1fr_120px_1fr] text-[10px] font-mono uppercase tracking-wider text-slate">
        <span className="text-right">Your crowd</span>
        <span />
        <span>{brand} fans</span>
      </div>
      {ids.map((id) => {
        const a = crowd.get(id)?.count ?? 0;
        const b = fans.get(id)?.count ?? 0;
        const name = crowd.get(id)?.name || fans.get(id)?.name || id.split(":").pop();
        const shared = a > 0 && b > 0;
        return (
          <div key={id} className="grid grid-cols-[1fr_120px_1fr] items-center gap-0 text-xs" role="row">
            <div className="flex justify-end">
              <div className="h-3 rounded-l-[2px]" style={{ width: `${(a / max) * 100}%`, background: shared ? "#FF5A1F" : "#EEE9E0" }} />
            </div>
            <div className={`truncate px-2 text-center ${shared ? "font-semibold" : "text-slate"}`} title={name}>
              {name}
            </div>
            <div className="flex">
              <div className="h-3 rounded-r-[2px]" style={{ width: `${(b / max) * 100}%`, background: shared ? "#FF5A1F" : "#6E6A64" }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-[10px] text-slate">Bar length = how many signals in each group carry the tag (Qloo compare_audiences). Amber = shared.</p>
    </div>
  );
}

export function LocalBars({ hotspots, city }: { hotspots: { area: string; affinity_rank: number }[]; city?: string | null }) {
  if (!hotspots?.length) return <p className="font-mono text-xs text-slate">No national heatmap returned.</p>;
  return (
    <ol className="space-y-1">
      {hotspots.slice(0, 8).map((h) => {
        const hi = city && h.area.toLowerCase().includes(city.toLowerCase().split(",")[0]);
        return (
          <li key={h.area} className="grid grid-cols-[110px_1fr_44px] items-center gap-2 text-xs">
            <span className={`truncate ${hi ? "font-bold" : ""}`}>{h.area}</span>
            <span className="h-2.5 rounded-[2px] bg-paper-3">
              <span className="block h-full rounded-[2px]" style={{ width: `${Math.max(4, (h.affinity_rank - 0.8) * 500)}%`, maxWidth: "100%", background: hi ? "#F2C14E" : "#EEE9E0" }} />
            </span>
            <span className="text-right font-mono">{(h.affinity_rank * 100).toFixed(1)}</span>
          </li>
        );
      })}
    </ol>
  );
}
