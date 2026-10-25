# Report Studio: AI client reporting (portfolio demo)

An AI reporting app for marketing agencies. It turns each client's Analytics, Search Console, Ads, Business Profile and CRM numbers into a dashboard, flags what changed, drafts the monthly summary, and checks every number in the summary against the source data. The agency (Fieldline Digital) and its three clients are invented.

**Live:** https://guhjkw.github.io/ai-report-studio-1025/

## What it does
| Piece | What you see | How it works (`src/reportEngine.js`) |
|---|---|---|
| KPIs | 6 cards with change and a 6-month trend line | 14 metrics computed from raw source fields (close rate = booked / leads, cost per ad lead = spend / conversions, click rate = clicks / impressions), each with its source and formula |
| Flags | Risks, wins, changes and gaps, ranked | A big swing (over your threshold) or a break in the trend (this month's change compared with the previous months' changes). Direction-aware: a higher average position is a risk. A missing source is reported as a gap, never estimated |
| AI draft | Sentences that each carry their numbers | Built from computed metrics only. Client sentences and team notes are separate, so "check the new spend" never reaches a client |
| Number checker | Live as you edit | Every number in the text must match a metric for that client and month, at the precision written ($279k matches $279,000; $280k does not). Years are ignored. An untraced number blocks "ready to send" |
| Client report | The shareable report as the client sees it | KPI tiles, the checked summary, source list, readable share link |
| Video script | Five talking points | Built from the same checked numbers |

## Try it
Change 192 to 210 in AI insights. Pick Kestrel Electric (search drop) or Oakhollow (missing Business Profile data). Move the "Big swing" slider. Switch to September.

## Files
```
index.html             the app (built from index.src.html with the sample data embedded)
src/reportEngine.js    all the logic, loaded by the app and the tests
data/clients.json      invented agency, clients and six months of source data
tests/verify.js        node tests on the engine
tests/browser-check.py Playwright tests that drive the real app
```

## Tests
```
node tests/verify.js            # 51 passed, 0 failed
python3 tests/browser-check.py  # 23 passed, 0 failed
```

## Extend it
The delivered version reads each source through its official API (GA4 Data API, Search Console API, Google Ads API, Business Profile, the client's CRM) with read-only access the agency provides, stores every number with where it came from, and can add a second model to cross-check each summary.

## Honest scope
Invented agency, clients and numbers. Nothing connects to a live account. The demo draft is template-written from computed numbers so it runs without an API key; a delivered build has Claude write it, with the same checker in front. The maths, the flags, the draft writer and the number checker are real code. No client build is shown or claimed.

Built by Taiwo, Pathfinder Automation Solutions.
