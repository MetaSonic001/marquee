# Decisions & deviations from the spec

| Spec | Reality | Decision |
|---|---|---|
| Harness default endpoint | The hackathon key is valid only on `https://hackathon.api.qloo.com` | Set `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL` for the harness process |
| Names as Qloo signals | `qloo_recommend` with names returns `needs_input` (artist vs person vs album) | Resolve every signal with `qloo_describe` first; pass confirmed UUIDs only |
| `compare_audiences` as "overlap %" | It returns tag profiles (`a`, `b`). A crowd of artists vs a brand shares no tags (different ontologies) | Compare the crowd with the **brand fans' top artists** (`recommend(artist, signals=[brand])`) and count tags shared in the crowd's top 20 — "X's fans share 9 of your crowd's top 20 tastes" |
| `where_popular` city vs national ratio ("1.8×") | It returns geohash heatmaps with relative `affinity_rank`, not city names or comparable ratios | Local strength = mean `affinity_rank` of the brand's top areas in the event city, shown as "Top X% of areas". National hotspots are labelled with the nearest major city (public coordinates table) |
| Momentum "+23% over 12 months" | Hackathon trend series contain about 10 weekly points, all identical | Flat series → "Flat" in the UI, excluded from the Fit (re-weighted) rather than scoring every brand 0% |
| `groq/compound` for web research | Not available on the provided keys (404) | `openai/gpt-oss-20b` (fallback `gpt-oss-120b`) with Groq's built-in `browser_search`. Findings are kept only if their domain appears in the executed search output; results cached per brand for 7 days |
| Groq model IDs | Available: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` | Agent: gpt-oss-120b. Writer + vision: qwen3.8-27b. Search: gpt-oss-20b. All env-configurable |
| Groq free tier | About 8K tokens/minute and 200K tokens/day per model | Per-model rolling token budget, model fallback chain, prompt cache, web research capped at 4 brands/run and cached, deterministic number-backed fallback copy. Upgrade to Groq Dev tier for heavier use |
| Category classification "from Qloo tags, LLM fallback" | Qloo brand tags (`urn:tag:genre:brand:*`) are rich | Keyword rules over Qloo tags, then the Qloo description. No LLM call needed |
| Logos via logo.dev / favicon | Qloo returns an image URL per entity | Use Qloo's entity image, with a monogram fallback |
| Signed cookie workspace | Vercel and Render live on different domains (third-party cookies are blocked by Safari) | `itsdangerous`-signed workspace token stored in `localStorage` and sent as the `X-Workspace` header |
| Agent budget "14 tool calls" | Live-run time target and token limits | Max 8 tool calls / 25 s. Deterministic category-tag seeds guarantee natural-fit coverage even if the agent is skipped |
| Local heroes | Probe confirmed `recommend(place, filter_location=city)` returns geocoded places | Shelf kept |
| PDF export | `@react-pdf/renderer` adds weight | Print-optimised `/events/[id]/report` route with `window.print()` |
| Run-event persistence | Per-event writes to remote Postgres slowed runs | Events are kept in memory and flushed in batches; history is served from memory while a run is live |
| UI direction | First pass looked generic | Redesigned as "backstage pass + departure board": split-flap board, expanded Archivo display, Instrument Serif italic names, Geist UI, JetBrains Mono numbers, dark stage with a signal-orange accent |
| Hosting | — | Render free web service (native Python, no Docker) plus Vercel Hobby. If memory or cold starts hurt, switch the same service to Render Starter with no code changes |
| Overlap for non-music crowds | Comedians/teams vs brand fans' *artists* share almost no tags (different ontologies) — every brand scored 1/20 | Compare like with like: musician crowds vs brand fans' artists; person/team crowds vs brand fans' *people* (`recommend(target_type="person")`) |
| Identity tags in overlap | `compare_audiences` returns tags like language, gender, ethnicity | Excluded from "shared tastes" and from the overlap count (Qloo safe-use: no identity inference) |
| Local heroes quality | Place recommendations can include schools, airports, or venues in excluded categories (e.g. hookah lounges when tobacco is excluded) | Filtered out before the shelf is built |
| Demo crowds | Judges include Cedric the Entertainer, Todd Boehly (Dodgers/Chelsea), Michael Abrams (Live Nation) | Demo portfolio: comedy night (Cedric the Entertainer, Steve Harvey, D.L. Hughley, Kevin Hart), Dodgers watch party (Dodgers, Shohei Ohtani, Clayton Kershaw), indie festival, Latin arena tour. Real performers/teams/brands as taste signals; the events are fictional and unaffiliated |
