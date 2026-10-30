"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import type { EventCard, EventFull } from "@/lib/types";
import { MarqueeSign } from "@/components/marquee-sign";
import { MetricsRow, FitNumber } from "@/components/brand-card";
import { BrandLogo, SourceChip, ToolBadge } from "@/components/ui";

const ACTS = [
  {
    n: "I",
    t: "Drop in what you have",
    d: "A sponsor deck, a poster, a website or a lineup. Marquee reads PDFs and images, fills your brief, and spots sponsors already on your materials.",
    tools: ["vision", "qloo_describe"],
  },
  {
    n: "II",
    t: "Read the crowd with Qloo",
    d: "Your lineup becomes a taste profile across music, TV, film, podcasts, places and brands. An agent then hunts for the brands that crowd over-indexes on.",
    tools: ["qloo_recommend", "qloo_rank", "audience_demographics"],
  },
  {
    n: "III",
    t: "Get a shortlist with receipts",
    d: "Every brand is measured: taste match, audience overlap, local strength and momentum — plus cited web evidence of past sponsorships.",
    tools: ["compare_audiences", "where_popular", "trends", "web_search"],
  },
];

const ANSWERS = [
  { k: "01", t: "Fit is not equal", d: "Every brand “fits” a big show on paper. Marquee measures how unequal fit really is — and fit is what makes a sponsor's activation land with fans." },
  { k: "02", t: "Pick the right inbound brand", d: "Three beverage brands want exclusivity. Sponsor slots rank them head-to-head for your crowd with Qloo, and explain the winner in numbers." },
  { k: "03", t: "Find the next sale", d: "Hidden gems and the portfolio view surface categories your crowd loves that nobody is selling yet — new revenue inbound demand never shows you." },
];

const WHO = ["Promoters & partnership teams", "Festivals", "Comedy & concert tours", "Venues & clubs", "College fests", "Sports supporter events"];

export default function Landing() {
  const { data: samples } = useQuery({ queryKey: ["samples"], queryFn: () => api<EventCard[]>("/samples") });
  const first = samples?.[0];
  const { data: ev } = useQuery({ queryKey: ["event", first?.id], queryFn: () => api<EventFull>(`/events/${first!.id}`), enabled: !!first });
  const hero = ev?.matches.filter((m) => m.shelf === "hidden" && !m.is_existing).sort((a, b) => b.fit - a.fit)[0];
  const tickerBrands = Array.from(new Set((samples || []).flatMap((s) => s.top_brands.map((b) => b.name))));

  return (
    <div>
      {/* HERO */}
      <section className="spot">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate">
              <span className="h-1.5 w-1.5 rounded-full bg-bulb" /> Sponsor discovery · powered by Qloo&apos;s taste graph
            </p>
            <h1 className="mt-6 font-display text-[44px] leading-[0.95] sm:text-[64px] lg:text-[76px]">Stop guessing who sponsors your event.</h1>
            <p className="mt-5 max-w-xl font-serif text-[26px] italic leading-snug text-ink-2 sm:text-[30px]">
              Tell us about your event. Marquee tells you which brands to approach — and why your crowd already loves them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/events/new" className="inline-flex items-center gap-2 rounded-full bg-bulb px-6 py-3 font-medium text-[#0c0c0d] transition-colors hover:bg-ink" data-testid="cta-find">
                Find sponsors for my event <ArrowRight size={16} />
              </Link>
              <Link href="/portfolio" className="inline-flex items-center gap-2 rounded-full border border-rule px-6 py-3 font-medium hover:border-ink" data-testid="cta-demo">
                See the demo portfolio
              </Link>
            </div>
            <p className="mt-6 text-xs text-slate">No signup. Demo workspace preloaded with four real-performer crowds, computed by the live pipeline.</p>
          </div>
          <div>
            <MarqueeSign title={first?.name || "SEAN Fest"} subtitle={first ? `${first.type_label} · ${first.city}` : "loading"} brands={first?.top_brands.map((b) => b.name) || []} label="Now showing" compact />
            {hero && (
              <div className="pass mt-4 p-4">
                <div className="flex items-start gap-3">
                  <BrandLogo name={hero.name} src={hero.logo_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bulb">Hidden gem · {hero.category}</p>
                    <p className="name truncate text-[30px] leading-none">{hero.name}</p>
                  </div>
                  <FitNumber fit={hero.fit} size="sm" />
                </div>
                <div className="mt-3">
                  <MetricsRow m={hero.metrics} />
                </div>
                {hero.why[0] && (
                  <p className="mt-3 text-sm text-ink-2">
                    {hero.why[0].text} <SourceChip label={hero.why[0].source} />
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {tickerBrands.length > 0 && (
        <div className="overflow-hidden border-y border-rule py-3" aria-hidden>
          <div className="ticker flex w-max gap-10 whitespace-nowrap">
            {[...tickerBrands, ...tickerBrands, ...tickerBrands].map((b, i) => (
              <span key={i} className="flex items-center gap-10 font-mono text-xs uppercase tracking-[0.2em] text-slate">
                {b} <span className="text-bulb">✦</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="bone">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate">The problem</p>
            <h2 className="mt-3 font-display text-4xl leading-[0.95] sm:text-5xl">Sponsorship is still sold on guesswork.</h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed">
              Hosts copy whoever sponsored a similar event, or ask around. Meanwhile, brands increasingly want proof that an audience fits them. Nobody in the room can show it.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-rule p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate">Incumbents ask</p>
              <p className="mt-3 font-serif text-3xl italic leading-tight">“Who sponsored events like yours?”</p>
            </div>
            <div className="rounded-2xl bg-[#0c0c0d] p-6 text-[#eee9e0]">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff5a1f]">Marquee asks</p>
              <p className="mt-3 font-serif text-3xl italic leading-tight">“What does your crowd love?”</p>
              <p className="mt-4 text-xs text-[#8d8880]">Only Qloo&apos;s cross-domain taste graph can answer that.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate">The programme</p>
        <h2 className="mt-3 max-w-3xl font-display text-4xl leading-[0.95] sm:text-5xl">An agent that works the room in three acts.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {ACTS.map((a) => (
            <article key={a.n} className="pass flex flex-col p-6">
              <span className="font-serif text-6xl italic text-bulb">{a.n}</span>
              <h3 className="mt-4 font-display text-xl">{a.t}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-2">{a.d}</p>
              <div className="perf -mx-6 mt-6 flex flex-wrap gap-1.5 px-6 pt-4">
                {a.tools.map((t) => (
                  <ToolBadge key={t} tool={t} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-rule">
        <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate">For the biggest promoters too</p>
              <h2 className="mt-3 font-display text-4xl leading-[0.95] sm:text-5xl">“Brands come to us anyway.”</h2>
              <p className="mt-4 font-serif text-2xl italic text-ink-2">Good. Here&apos;s what Marquee does with that.</p>
            </div>
            <div className="divide-y divide-rule">
              {ANSWERS.map((a) => (
                <div key={a.k} className="grid grid-cols-[48px_1fr] gap-4 py-5">
                  <span className="font-mono text-sm text-bulb">{a.k}</span>
                  <div>
                    <h3 className="font-display text-xl">{a.t}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{a.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate">Demo scenario · a promoter&apos;s partnerships team</p>
            <h2 className="mt-3 font-display text-4xl leading-[0.95] sm:text-5xl">Four real crowds. Four different shortlists.</h2>
          </div>
          <Link href="/portfolio" className="inline-flex items-center gap-1.5 text-sm underline decoration-bulb underline-offset-4">
            Open the portfolio grid <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(samples || []).map((e) => (
            <Link key={e.id} href={`/events/${e.id}`} className="pass group flex flex-col p-6" data-testid="sample-card">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-bulb">
                {e.type_label} · {e.city}
              </p>
              <h3 className="mt-2 font-display text-2xl">{e.name}</h3>
              <p className="mt-1 text-sm text-slate">{e.tagline}</p>
              <p className="mt-4 text-xs text-slate">Crowd: {e.signals.slice(0, 4).join(", ")}</p>
              <div className="perf -mx-6 mt-6 px-6 pt-4">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-slate">Now showing</p>
                <ol className="space-y-1.5">
                  {e.top_brands.map((b, i) => (
                    <li key={b.name} className="flex items-center gap-2.5">
                      <span className="w-4 font-mono text-[10px] text-slate">{i + 1}</span>
                      <BrandLogo name={b.name} src={b.logo_url} size={22} />
                      <span className="name flex-1 truncate text-xl">{b.name}</span>
                      <span className="font-mono text-xs">{Math.round(b.fit)}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-sm text-bulb opacity-80 group-hover:opacity-100">
                Open shortlist <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate">Fictional events with real performers, teams and brands as taste signals. Not affiliated with or endorsed by Live Nation or any performer, team or brand shown.</p>
      </section>

      <section className="bone">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="font-display text-4xl leading-[0.95] sm:text-6xl">Built for whoever sells the sponsorship.</h2>
            <div className="mt-6 flex flex-wrap gap-2">
              {WHO.map((w) => (
                <span key={w} className="rounded-full border border-rule px-3 py-1.5 text-sm">
                  {w}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-[#0c0c0d] p-8 text-[#eee9e0]">
            <p className="font-serif text-3xl italic leading-tight">Every number shows its Qloo source. Every claim links its evidence. No guesses.</p>
            <Link href="/events/new" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#ff5a1f] px-6 py-3 font-medium text-[#0c0c0d] hover:bg-[#eee9e0]">
              Find sponsors for my event <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
