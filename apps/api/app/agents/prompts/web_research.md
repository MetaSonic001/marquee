Search the public web to answer two questions about the brand "{brand}":

1. Has {brand} sponsored or partnered with events, festivals, concert tours, comedy shows or sports events in 2025 or 2026? Prioritise events similar to a {event_type}.
2. Does {brand} have a public partnerships or sponsorship page (a page on the brand's own site where event organisers can apply or learn about sponsorship)?

Run at most 2 searches. Only report what the search results show. Never guess. Never include personal names, emails or phone numbers.

Reply with JSON only, in this exact shape:
{"findings": [{"event": "event or property name", "year": "2025", "kind": "festival|tour|sports|comedy|other", "source_domain": "domain.com of the result that shows this"}], "partnerships_page": "full URL or null"}

If nothing is found, reply {"findings": [], "partnerships_page": null}.
