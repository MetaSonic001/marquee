"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtOverlap, fmtTaste } from "@/lib/format";
import type { EventCard, EventFull } from "@/lib/types";

type Beat = { t: string; screen: string; href?: string; doThis: string[]; say: string };

export default function DemoGuide() {
  const { data: samples } = useQuery({ queryKey: ["samples"], queryFn: () => api<EventCard[]>("/samples") });
  // The walkthrough features the comedy night (for Cedric) and the Dodgers watch party (for Boehly)
  const comedy = samples?.find((s) => s.name === "Laugh Track Live") || samples?.[0];
  const dodgers = samples?.find((s) => s.name === "Blue Heaven Watch Party") || samples?.[1];
  const { data: ev } = useQuery({ queryKey: ["event", comedy?.id], queryFn: () => api<EventFull>(`/events/${comedy!.id}`), enabled: !!comedy });
  const { data: dev } = useQuery({ queryKey: ["event", dodgers?.id], queryFn: () => api<EventFull>(`/events/${dodgers!.id}`), enabled: !!dodgers });

  const ranked = (ev?.matches || []).filter((m) => m.shelf !== "local" && !m.is_existing && !m.hidden).sort((a, b) => b.fit - a.fit);
  const top3 = ranked.slice(0, 3).map((m) => m.name);
  const top = ranked[0];
  const gem = ranked.find((m) => m.shelf === "hidden");
  const bev = dev?.slots.find((s) => s.name === "Official beverage partner");
  const bevTop = bev ? [...bev.ranking].sort((a, b) => b.slot_score - a.slot_score) : [];
  const checks = [...(dev?.checks || [])].sort((a, b) => b.fit - a.fit);
  const e = (s?: string | number | null, fb = "…") => (s === undefined || s === null || s === "" ? fb : String(s));
  const id = comedy?.id;
  const did = dodgers?.id;

  const beats: Beat[] = [
    {
      t: "0:00 – 0:25",
      screen: "Landing page",
      href: "/",
      doThis: ["Start on the landing page, hero visible. Let the split-flap board settle.", "Slowly scroll once to the “Incumbents ask / Marquee asks” section, then back up."],
      say: "Hi, we're Team Enigma Trio, and this is Marquee. Live Nation — the world's leading live entertainment company, and the owner of Ticketmaster — earned about 1.3 billion dollars from sponsorship and advertising last year. Brands pay real money to stand in front of a crowd, and Live Nation has a whole division to sell that. But most hosts don't: the indie festival, the college fest, the comedy night, the community run, the club night, the meetup. They pick sponsors by guesswork — copying whoever sponsored a similar event. Incumbents ask “who sponsored events like yours?” Marquee asks “what does your crowd actually love?” — and only Qloo's taste graph can answer that.",
    },
    {
      t: "0:25 – 0:55",
      screen: "Add your event (intake)",
      href: "/events/new",
      doThis: [
        "Click “Add your event”. Drop docs/demo/laugh_track_poster.png into zone A and click “Read my event”.",
        "Show the brief filling in: name, comedy type, St. Louis, ~2,500 seats, the four comedians as matched chips, and Tobacco switched on from the poster's “no tobacco partners” line. Point at the “from laugh_track_poster.png” source tags.",
        "Type “Chris Tucker” as an extra signal: Qloo returns two Chris Tuckers (the comedian and a college basketball player). Pick the comedian.",
      ],
      say: "A host starts with whatever they already have — a poster, a sponsor deck, a link. Here's a poster for a comedy night in St. Louis. Marquee reads it with a vision model, fills the brief, and tags every field with where it came from — it even picked up “no tobacco partners” as an exclusion. Each comedian is matched live in Qloo's graph. And when a name is ambiguous — there's more than one Chris Tucker — we ask instead of guessing.",
    },
    {
      t: "0:55 – 1:20",
      screen: "Soundcheck (agent run)",
      href: id && ev?.latest_run_id ? `/events/${id}/runs/${ev.latest_run_id}` : undefined,
      doThis: ["Open “View the agent run” on Laugh Track Live (or press Find my sponsors on your own event and let it stream).", "Point at the orange tool badges and the taste fingerprint filling in on the right."],
      say: "Here's the agent at work. Eight explicit stages, and every badge is a real Qloo tool call: qloo_recommend reads the crowd's taste across music, TV, film, podcasts and places; a Groq tool-calling agent explores the crowd's other tastes to find hidden-gem brands; qloo_rank ranks every candidate; compare_audiences, where_popular and trends measure each one; and a web-search step looks for cited sponsorship history.",
    },
    {
      t: "1:20 – 2:00",
      screen: "Shortlist + brand drawer",
      href: id ? `/events/${id}` : undefined,
      doThis: [
        "Show the departure board: “Now showing” the top three brands.",
        "Scroll through Natural fits, then Hidden gems.",
        `Click the hidden gem “${e(gem?.name)}” to open the drawer: Overlap disc, shared tastes, tag profile, local heatmap, score breakdown.`,
        "Star 2–3 brands.",
      ],
      say: `For Laugh Track Live — a comedy night with Cedric the Entertainer, Steve Harvey, D.L. Hughley and Kevin Hart as taste signals — the board says “now showing” ${e(top3.join(", "))}. Every card is a report card with four Qloo numbers. Taste match: ${e(top ? fmtTaste(top.metrics) : null)} among all candidates. Audience overlap: ${e(top ? fmtOverlap(top.metrics) : null)} of the crowd's top tastes are shared with the brand's fans. Local strength in St. Louis, and momentum. Natural fits are the categories you'd expect. Hidden gems are brands you'd never have thought of — like ${e(gem?.name)}, whose fans share ${e(gem ? fmtOverlap(gem.metrics) : null)} of this crowd's top tastes. Open it, and you can see exactly why: the overlap disc, the shared tastes, the local heatmap, and how every point of the score was calculated. Every bullet carries its source.`,
    },
    {
      t: "2:00 – 2:35",
      screen: "Sponsor slots",
      href: did ? `/events/${did}?tab=slots` : undefined,
      doThis: ["Switch to the Blue Heaven Watch Party (Portfolio → the Dodgers row) and open Sponsor slots. Show the “ideal sponsor lineup” strip.", "Scroll to Official beverage partner: podium and “Why #1 over #2”.", "Switch the lens to “Strong in our city” on the Shortlist tab and come back to show the order change."],
      say: `Now a sports crowd: a Dodgers supporters' watch party in LA, built from the Dodgers, Shohei Ohtani and Clayton Kershaw. “But brands come to us anyway” — so which one gets the exclusive slot? Here's the official beverage partner slot. We typed in inbound brands — Coca-Cola, Pepsi, Modelo, Coors Light — next to the brands Marquee discovered, and qloo_rank ranked them head to head for this crowd. ${e(bevTop[0]?.name)} wins, leading ${e(bevTop[1]?.name)} by ${e(bev?.margin)} points — and here's why, metric by metric. If it's within five points, we honestly say “too close to call”. Change the ranking lens and the order updates instantly, with no new API calls.`,
    },
    {
      t: "2:35 – 3:05",
      screen: "Check a brand + Crowd",
      href: did ? `/events/${did}?tab=check` : undefined,
      doThis: ["Still on the Dodgers watch party: open Check a brand and show the three inbound offers side by side with verdicts.", "Then open Laugh Track Live → Crowd tab: bubble fingerprint and the one-paragraph crowd summary."],
      say: `When a brand approaches you inbound, Check a brand gives a quantified verdict in seconds and lines up competing offers side by side. For this Dodgers crowd, ${e(checks[0]?.name)} leads the inbound offers at ${e(checks[0] ? Math.round(checks[0].fit) : null)} — evidence for category exclusivity and pricing. And the Crowd tab is a ready-made slide for any sponsor deck: the comedy crowd's fingerprint across podcasts, music, TV and film, written only from Qloo data.`,
    },
    {
      t: "3:05 – 3:30",
      screen: "Portfolio",
      href: "/portfolio",
      doThis: ["Open Portfolio. Point at the four rows: comedy night, Dodgers watch party, Latin arena tour, indie festival.", "Click one cell to open that brand's card, then scroll to “Under-sold categories”."],
      say: "Here's the same engine across four very different crowds: the comedy night, the Dodgers watch party, a Latin-pop arena tour — the Live Nation-scale case — and an indie festival in Austin. Same brands, very different fit — and under-sold categories show the next sale that inbound demand never surfaces.",
    },
    {
      t: "3:30 – 3:50",
      screen: "Compare vs LLM-only + export",
      href: id ? `/events/${id}?tab=llm` : undefined,
      doThis: ["Open Laugh Track Live → Compare vs LLM-only. Point at “They agree on 0 of 10”.", "Back on Shortlist, click PDF report in the bottom bar."],
      say: "And this is why Qloo matters. Same comedy-night brief: a plain LLM suggests Bud Light, Coors Light and Red Bull — generic guesses with no numbers and no sources. Marquee and the LLM agree on zero of ten. Marquee gives you a quantified, cited shortlist. Export it as a CSV or a clean PDF report to drop into your own deck.",
    },
    {
      t: "3:50 – 4:15",
      screen: "Back to landing (close)",
      href: "/",
      doThis: ["End on the hero with the board."],
      say: "Under the hood: a Next.js front end, a FastAPI backend holding a live Qloo MCP session through the official harness, Groq models for vision, agent tool use and writing, and Supabase Postgres. Scores are computed deterministically — the language model never invents a number. Marquee: tell us about your event, and we'll tell you which brands to approach — and why your crowd already loves them.",
    },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-10 sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate">Run-sheet · Team Enigma Trio</p>
      <h1 className="mt-2 font-display text-5xl leading-[0.95]">Demo guide</h1>
      <p className="mt-3 max-w-2xl font-serif text-2xl italic text-ink-2">A four-minute walkthrough. Numbers below are pulled live from the stored runs, so the script matches what is on screen.</p>
      <ol className="mt-10 space-y-4">
        {beats.map((b, i) => (
          <li key={i} className="pass grid gap-4 p-5 md:grid-cols-[150px_1fr]">
            <div>
              <p className="font-mono text-sm text-bulb">{b.t}</p>
              <p className="mt-1 font-display text-lg leading-tight">{b.screen}</p>
              {b.href && (
                <Link href={b.href} className="mt-2 inline-block text-xs underline decoration-bulb underline-offset-4">
                  Open screen →
                </Link>
              )}
            </div>
            <div>
              <ul className="mb-3 space-y-1 text-sm text-slate">
                {b.doThis.map((d) => (
                  <li key={d}>▸ {d}</li>
                ))}
              </ul>
              <p className="border-l-2 border-bulb pl-4 font-serif text-xl italic leading-snug">“{b.say}”</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
