# Qloo probe findings (harness 0.1.26, hackathon endpoint)

Reproduce with `uv run python scripts/qloo_probe.py <calls.json>`. Recorded envelopes: `apps/api/tests/fixtures/qloo/`.

- **MCP tools** (`listTools`): capabilities, recommend, rank, describe, where_popular, compare_audiences, entity_tags, audience_demographics, trends, find_tags. Full schemas: `docs/mcp_tools.json`.
- **Entity resolution:** names → `needs_input` (artist/person/album duplicates). `describe` with a `type` resolves cleanly. Pass UUIDs downstream.
- **Brands:** strong coverage. `recommend(brand)` for an indie crowd → Urban Outfitters, Dr. Martens, American Apparel, Free People… `include_tags` with `urn:tag:genre:brand:*` URNs works for category seeding (drinks, wine_and_spirits, energy_drink, telecom, fashion, automotive, electronics, entertainment:media).
- **Rank:** returns affinity per option for one shared profile. Beverage head-to-head for SEAN Fest: Red Bull > Coca-Cola > … With `signal_location` it filters heavily (1 result), so it isn't used for local strength.
- **compare_audiences:** returns tag profiles with counts. Crowd vs brand-fans' artists gives a meaningful overlap (Urban Outfitters 9/20 vs Pepsi 4/20 shared tags for SEAN Fest).
- **where_popular:** geohash heatmap with `affinity_rank`. `within` accepts city strings ("Austin, TX").
- **Places / city data:** `recommend(place, filter_location="Austin, TX")` returns geocoded Austin places → **Local heroes shelf enabled**.
- **Demographics:** age and gender skews per entity (relative values).
- **Trends:** weekly `population_percentile`, but only about 10 points and flat in this dataset → shown as "Flat".
- **Batch entity lookup:** `qloo api entity --id a,b,c --json` returns tags (incl. `genre:brand:*`) used for categories.
