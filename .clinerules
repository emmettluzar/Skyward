<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Skyward — Agent Instructions

Skyward is a dark-sky trip planner: it finds where to drive tonight for the best
stargazing, and tells you whether it's worth going at all.

**`prd.md` is the product spec of record** — scoring formulas, data sources, phase
plan, UX. Read it before your first edit in a session. If this file conflicts with
`prd.md`, `prd.md` wins; then update this file to match.

## 0. Non-negotiables

1. **ZERO COST.** Never introduce a dependency, API, or service requiring a credit
   card, paid tier, or trial. Specifically forbidden: Google Maps Platform APIs,
   Mapbox, keyed MapTiler, Astrospheric API, Meteoblue, paid weather tiers, the
   Falchi/GFZ World Atlas raster, anything with a "free trial." Google/Apple Maps
   **deep links are allowed** — they're just URLs.
   If a task appears to need a paid service, STOP and propose a free alternative in
   a comment instead of adding it.
2. **Never commit raster/geo binaries to git.** Data artifacts live in Cloudflare R2,
   referenced via `data/manifest.json` (url + sha256 + version). `.gitignore` must
   cover `*.tif *.tiff *.pmtiles *.mbtiles *.zip *.gz data/raw/`.
3. **Never claim our modeled values ARE the Bortle scale.** Bortle is a subjective
   whole-sky visual judgement; we model zenith brightness. UI shows "≈ Bortle 4"
   with an explanatory tooltip. This is a credibility requirement, not a style
   preference.
4. **Every displayed value carries provenance** — source name, data vintage, and for
   forecasts a confidence level. No naked numbers.
5. **Attribution is a launch blocker.** OSM (ODbL), Open-Meteo (CC BY 4.0), DarkSky
   IDSP (CC BY 4.0), OpenFreeMap, FOSSGIS/Valhalla, NASA, EOG, 7Timer must appear in
   the UI. Update `/about` in the same PR that adds a source.

## 1. Stack — use exactly these; ask before adding any dependency

- Next.js 16 (App Router, RSC, Route Handlers) · React 19 · TypeScript strict
- Tailwind CSS v4 · shadcn/ui · lucide-react
- MapLibre GL JS v5 + OpenFreeMap (`https://tiles.openfreemap.org/styles/dark`)
- TanStack Query v5 (server data) · Zustand (UI state only)
- `@turf/turf` · `pmtiles` · `geotiff.js` · `h3-js`
- `astronomy-engine` — ALL sun/moon/twilight/galactic math. Never call an API for
  ephemeris; it must work offline.
- Dexie (IndexedDB) for local-first saved spots and trip logs
- Vitest (unit) · Playwright (e2e) · Zod (validate EVERY upstream response)
- Pipeline: Python 3.12 + uv, rasterio/numpy/scipy/gdal, isolated in `/pipeline`
- Deploy: Cloudflare Workers/Pages preferred, or Vercel Hobby
- pnpm. Node 22+.

## 2. Directory structure — follow it

app/
page.tsx # Verdict home (Mode 2)
search/ map/ site/[id]/ saved/ settings/ about/
api/darkness|candidates|isochrone|matrix|conditions|places|horizon|verdict/route.ts
components/
map/ # MapLibre wrapper, layers, legend, isochrone, markers
verdict/ # VerdictCard, ReasonChips, BetterNightBanner
tonight/ # HourRibbon, MoonCard, TransparencyCard, ComfortCard
ui/ # shadcn primitives only
lib/
darkness/ convert.ts bortle.ts raster.ts
scoring/ config.ts quality.ts worthit.ts window.ts verdict.ts
search/ threshold.ts timebudget.ts optimize.ts snap.ts nms.ts
upstream/ openmeteo.ts valhalla.ts overpass.ts seventimer.ts dem.ts
swpc.ts _client.ts
geo/ h3.ts bearing.ts horizon.ts
types/ *.ts (+ colocated Zod schemas)
pipeline/ *.py README.md
data/ manifest.json only — NO BINARIES
tests/ unit/ e2e/ fixtures/


## 3. The scoring math is sacred

All formulas come from `prd.md` §2.1 and §4. Implement them exactly.

- **All magic numbers live in `lib/scoring/config.ts`** as a typed, exported,
  documented object. Zero hardcoded coefficients anywhere else. Ever.
- **`Q` is multiplicative:** `S_dark · C_cloud · T_trans · M_moon · H_open · A_access`.
  Do not "simplify" to a weighted sum — a cloudy Bortle 1 site must score ~0.
- Canonical conversions in `lib/darkness/convert.ts`, unit-tested:
  ```ts
  const B_NATURAL_MCD = 0.171168465
  sqmFromBrightness(bTotalMcd) = Math.log10(bTotalMcd / 1.08e8) / -0.4
  nelmFromSqm(m) = 7.93 - 5 * Math.log10(10 ** (4.316 - m / 5) + 1)

Verify b_art = 0 → SQM = 22.00. Add that as a test.

    Every scoring function is pure: (inputs) => number. No I/O, no Date.now().
    Time is always an injected parameter — this is what makes it testable and offline-safe.
    Every scoring function returns a human-readable reasons: string[] alongside its
    number (or has a paired explain()). The UI must always justify the verdict.
    Units in identifiers when ambiguous: driveTimeMin, distKm, sqmMpsas,
    radianceNwCm2Sr, brightnessMcdM2, cloudFrac (0–1, not percent). Convert
    API percentages to fractions once, at the boundary.

4. Upstream API rules — this is where the project lives or dies

    All external calls go through lib/upstream/_client.ts. Never fetch() a third
    party from a component or a route-handler body. _client.ts provides: 8s timeout,
    2 retries with jittered backoff, per-host rate limiting, circuit breaker, Zod
    parsing, structured logging.

    Batch relentlessly. Hard budget per user search: ≤1 Valhalla matrix, ≤1 Valhalla
    isochrone, ≤2 Open-Meteo, ≤1 Overpass. Open-Meteo accepts comma-separated
    latitude/longitude — one call for all candidates. If you write a for loop
    with a network call inside it, you did it wrong.

    Cache TTLs: darkness point 30d · horizon 90d · places 7d · isochrone 24h ·
    matrix 6h · conditions 20m · verdict 15m. Cache keys use coordinates rounded to
    3 decimals (~110 m) — both a cache-hit strategy and a privacy measure.

    Valhalla (FOSSGIS demo, no key): always send
    headers: { 'X-Client-Id': 'skyward.app' }. Respect fair use. Keep
    lib/upstream/valhalla.ts swappable so self-hosting is a one-env-var change
    (VALHALLA_BASE_URL).

    Graceful degradation is mandatory. On upstream failure:
        7Timer down → seeing_bonus = 1.0, mark partial: ['seeing']
        Valhalla down → estimate driveTimeMin from haversine × 1.35 road factor ÷ 70 km/h,
        set estimated: true (UI shows "~")
        Overpass down → return raw coordinates with snapped: false
        Open-Meteo down → darkness results only, verdict = "conditions unknown"

    Never fail a whole request because one enrichment failed. Return
    { data, partial: string[], estimated: boolean } and let the UI be honest.

5. Code conventions

    TS strict. No any. No non-null ! without a justifying comment. unknown at
    boundaries → Zod → typed.
    Server Components by default. 'use client' only for the map, forms, and anything
    touching geolocation or IndexedDB. Lazy-load MapLibre.
    Named exports only (except Next's required default page/layout exports).
    Files kebab-case, components PascalCase, hooks use-*.ts.
    No barrel index.ts re-export files — they wreck tree-shaking.
    Errors: typed AppError with code, userMessage, cause. Never surface a raw
    upstream error string to a user.
    Comments explain WHY (physics, licence constraints, rate limits), not WHAT. Cite
    the paper or source inline for any constant that came from one.
    A11y: keyboard-navigable map controls, aria-live on verdict updates, ≥4.5:1
    contrast in both themes, respect prefers-reduced-motion.
    Red-light night mode is a CSS-variable theme ([data-theme="red"]), not a filter
    hack. No white or blue pixels in that theme — including map style overrides.

6. Testing

    Any change to lib/scoring/** or lib/darkness/** REQUIRES unit tests. These are
    the product; treat them like a payments module.
    Required fixtures: Bortle 2 desert site, Bortle 8 urban site, full-moon overcast,
    new-moon clear, canyon-blocked horizon, gated park.
    Snapshot the verdict text for those fixtures so tuning changes show up in diffs and
    get reviewed intentionally.
    Mock all upstreams with MSW. Zero network calls in CI.
    Playwright smoke path: grant location → verdict renders <3s → open Mode 3 →
    isochrone draws → open a site → directions link is well-formed.

7. Safety, privacy, legal — product requirements, not boilerplate

    Never recommend a spot on a road shoulder, in a travel lane, on private land
    (access=private|no), or behind a locked gate. Filter in snap.ts.
    Every result card shows access confidence: Verified public / Likely public /
    Verify access before going.
    Site detail includes a compact field-safety note: tell someone your plan, likely no
    cell service, wildlife/terrain, temperature at 1am.
    Location: request permission with a reason string, keep precise coords client-side,
    round to 3 dp before any outbound call, never persist server-side without consent,
    no third-party analytics/trackers/cookies.

8. Workflow

    Build in prd.md §10 order (Phase 0 → 4). Don't start Phase 2 while Phase 1 is
    unfinished.
    Before coding a new feature, restate in 3 bullets: what you'll build, which files
    you'll touch, which upstreams/quotas it consumes.
    Small commits, conventional style: feat(scoring): add moon interference term.
    After each unit of work, report: what changed, how to verify locally, what's now
    unblocked, any assumption you made.
    If unsure about a physical/astronomical constant or a licence, say so and add a
    // TODO(verify): comment. Do not silently invent coefficients — a
    plausible-looking wrong constant is worse than a flagged gap.
    Prefer deleting code over adding flags. No dead code, no commented-out blocks, no
    speculative abstraction for a phase we haven't started.
