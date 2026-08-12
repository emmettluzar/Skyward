# Darkward — Product Requirements Document

> **Working name:** Skyward (alts: Starward, NightRun, Umbra, Darkward)
> **Version:** 1.0 · **Status:** Ready for build · **Owner:** you
> **One-liner:** Skyward tells you exactly where to drive tonight to see stars —
> and whether it's even worth leaving the house.

---

## 1. Problem & Positioning

### 1.1 The problem
An amateur stargazer wanting to see the Milky Way tonight must currently:
1. Open `lightpollutionmap.info`, eyeball a dark area.
2. Guess whether anywhere there is publicly accessible or has parking.
3. Open Google Maps, guess a drive time.
4. Open Clear Outside / Astrospheric to check clouds.
5. Check a moon-phase site.
6. Mentally combine all of it and usually give up.

Nothing joins **darkness + accessibility + drive time + tonight's sky conditions**
into a single decision.

### 1.2 The product thesis
Darkness is worthless without clear sky; clear sky is worthless without darkness;
both are worthless if the site is 4 hours away or on private land. The product's
value is **the join and the verdict**, not the map.

### 1.3 Non-goals (v1)
- Not a telescope-control or astrophotography-planning tool (no framing, no
  mount integration, no target-visibility ephemeris beyond Moon/Milky Way/planets).
- Not a social network. Not a campsite booking tool.
- Not a general weather app.
- No paid data sources, ever. See §11 constraints.

### 1.4 Target users
| Persona | Need |
|---|---|
| **Casual "I want to see the Milky Way"** (primary) | One tap → "Go here, leave at 9:40pm, it's worth it." |
| **Amateur astronomer w/ scope** | Bortle threshold, SQM numbers, seeing/transparency, dew & wind warnings, horizon openness. |
| **Astrophotographer** | Moonless window, transparency, forecast confidence, saved-spot log. |
| **Road-tripper / camper** | "Best dark site within 90 min of my route/hotel." |

---

## 2. Core Concepts & Definitions

### 2.1 The darkness metrics (all three exposed, one canonical internally)
Internally everything is stored and computed as **modeled zenith artificial
brightness** `b_art` in mcd/m². Everything else is a derived presentation.

| Metric | Meaning | Use in UI |
|---|---|---|
| **Raw radiance** | VIIRS DNB upward radiance, nW·cm⁻²·sr⁻¹ | "Raw data" mode; power users; honest about being *upward emission*, not sky quality. |
| **SQM (mpsas)** | Modeled zenith sky brightness, mag/arcsec² | Default numeric metric. Continuous, sortable, scientific. |
| **Bortle class** | 1–9 subjective scale, derived from SQM via table | Default *label* because users know it. Always shown with a "≈" and a tooltip explaining it's an approximation. |
| **NELM** | Naked-eye limiting magnitude | Secondary — most intuitive for casuals ("you'll see ~mag 6.5 stars"). |

**Conversions (canonical, implement once in `lib/darkness/convert.ts`):**

    b_total = b_art + b_natural            where b_natural = 0.171168465 mcd/m²
    SQM     = log10(b_total / 1.08e8) / -0.4        (b in mcd/m²)
    NELM    = 7.93 - 5 * log10(10^(4.316 - SQM/5) + 1)
    ratio   = b_art / b_natural            ("this sky is 3.2× brighter than natural")

**SQM → Bortle table** (document as approximate; source: Unihedron/Bortle):

| Bortle | SQM range (mpsas) |
|---|---|
| 1 | ≥ 21.99 |
| 2 | 21.89 – 21.99 |
| 3 | 21.69 – 21.89 |
| 4 | 20.49 – 21.69 |
| 5 | 19.50 – 20.49 |
| 6 | 18.94 – 19.50 |
| 7 | 18.38 – 18.94 |
| 8 | 17.80 – 18.38 |
| 9 | < 17.80 |

> **Editorial rule:** Never claim our map *is* the Bortle scale. Bortle is a
> subjective whole-sky visual judgement; we model zenith brightness. This is a
> hard requirement from the atlas author's own guidance and is a credibility issue.

### 2.2 "Live" light pollution — the honest answer
There is **no** true real-time street-level light-pollution feed. We offer a
three-tier data freshness selector and label each tier plainly:

| Tier | Source | Latency | Label shown to user |
|---|---|---|---|
| **Modeled (default)** | Our sky-brightness model built from VIIRS VNL annual (latest year) | ~annual | "Modeled sky brightness · 2025 data" |
| **Recent** | VIIRS VNL **monthly** composite | 1–2 months | "Recent satellite radiance · Jun 2026" |
| **Latest pass** | NASA **Black Marble VNP46A2/VNP46A1 NRT** (daily) | ~1 day | "Last satellite pass · noisy, cloud-affected" + warning |
| **Ground truth** | **Community SQM readings** (user-submitted) | live | "Measured by 3 users · avg 21.4" |

The genuinely **live** part of the product is *sky conditions* (cloud, moon,
transparency, aerosols), which is what actually changes night to night.

### 2.3 Site types (the "where exactly" filter)
| Type | Definition | Source |
|---|---|---|
| **Raw** | The nearest grid cell meeting the threshold, wherever it is. No accessibility guarantee. | Our raster |
| **Snapped** | Raw cell snapped to the nearest legal, parkable, open-sky spot within a search radius. **This is the default.** | OSM/Overpass |
| **Open green** | Snapped, but requiring open low-canopy land cover (meadow/grass/field/heath/lakeshore) | OSM landuse/natural |
| **Certified** | DarkSky International IDSP (Park/Reserve/Sanctuary/Community/Urban Place) | GFZ IDSP boundaries (CC BY 4.0) |
| **Public land** | PAD-US / national forest / BLM / state park / WMA | PAD-US (US), Protected Planet (intl., phase 3) |
| **Community** | User-submitted & rated spots | Our DB |

---

## 3. The Three Search Modes

All three share the same candidate scorer (§4) and verdict engine (§5). They
differ only in the *constraint* being applied.

### 3.1 Mode 1 — Threshold ("Nearest dark enough")
> "Find me the closest place that's at least Bortle 4."

**Inputs:** target darkness (Bortle slider 1–9, or SQM numeric, or radiance),
site type filter, optional hard max drive time.
**Output:** single primary result + 4 alternates, sorted by **actual drive time**
(never straight-line distance).

**Algorithm:**
1. Look up the precomputed **darkness distance transform** raster for the
   requested threshold class → O(1) read gives distance & bearing to nearest
   qualifying cell. (Precomputed offline for thresholds SQM ≥ 19.5, 20.5, 21.7,
   21.9 — i.e. Bortle ≤5/4/3/2 boundaries.)
2. Collect the **k = 40** nearest qualifying cells by great-circle distance
   (expanding-ring sample of the raster, dedup to ≥3 km spacing).
3. For each, apply the site-type filter (§6 snapping).
4. Single **Valhalla `/sources_to_targets` matrix** call → real drive times.
5. Sort by drive time; keep top 8; batch-score with weather (§4).
6. Return best + alternates, each with reason strings.

**Why:** nearest-by-air is frequently a 2× worse drive than a slightly farther
cell with highway access. Road-time-first ranking is a core differentiator.

### 3.2 Mode 2 — Worth It ("just decide for me") ⭐ flagship
> "Should I go out tonight, and where?"

**Inputs:** none required beyond location + (optional) "how far I'm willing to
drive" patience slider and "how long I plan to observe."
**Output:** a verdict card — **GO / MAYBE / STAY HOME** — with one recommended
site, the reasoning, and "better night" suggestion if applicable.

**Algorithm:** generate a diverse candidate set (Mode 1 candidates for every
threshold tier + all Certified/Public-land sites within the patience isochrone +
saved spots), score each with the full `W` formula (§4.3), and take the argmax.
Compare `W_best` against staying home and against the next 5 nights.

### 3.3 Mode 3 — Time Budget ("best within X minutes")
> "I have 45 minutes of driving in me. What's the best sky I can reach?"

**Inputs:** drive-time budget in **minutes** (15/30/45/60/90/120/custom),
departure time (affects traffic + weather window), site type filter.
**Output:** ranked list of up to 10 sites with the isochrone drawn on the map.

**Algorithm:**
1. **Valhalla `/isochrone`** with `costing=auto`, `contours=[{time: X}]`,
   `polygons=true`, `denoise=0.3`, `generalize=100` → GeoJSON polygon.
2. Rasterize polygon → mask our darkness grid (server-side, in a worker).
3. **Zonal top-N**: find the N darkest cells inside the mask with ≥5 km mutual
   spacing (non-maximum suppression) so results aren't 10 cells of one field.
4. Snap → score → rank by `Q` (not `W`, since drive time is already constrained,
   though `W` is still shown as a tiebreaker for "closer is better if equal sky").
5. Cache the isochrone by (rounded origin, budget, hour-bucket) for 24h.

---

## 4. The Scoring Engine (canonical spec — implement exactly)

All coefficients live in a single tunable config file `lib/scoring/config.ts` so
they can be adjusted without hunting through code.

### 4.1 Observing Quality `Q` — how good is this site tonight?

    Q = 100 · S_dark · C_cloud · T_trans · M_moon · H_open · A_access

**Multiplicative by design:** any near-zero factor must veto the trip. An
overcast Bortle 1 site scores ~0, which is correct.

Each factor ∈ [0, 1], evaluated over the **observing window** (see §4.2).

**S_dark — darkness (γ-shaped, diminishing returns):**

    S_dark = clamp( (SQM - 17.5) / (21.95 - 17.5), 0, 1 ) ^ 0.85

**C_cloud — clear-sky factor, layer-weighted:**

    c_low, c_mid, c_high ∈ [0,1] from Open-Meteo (window-averaged)
    C_cloud = (1 - c_low)^1.0 · (1 - c_mid)^0.85 · (1 - c_high)^0.55

Rationale: low cloud/fog is opaque; cirrus dims but doesn't block. Also compute
`C_best_hour` = max over hours in window, and surface **"clear from 11pm–1am"**
rather than a single averaged number. Fog risk gets an extra penalty when
`T_air - T_dew < 2°C` and wind < 5 km/h.

**T_trans — atmospheric transparency:**

    T_trans = exp(-1.9 · max(0, AOD550 - 0.05))
            · (1 - 0.25 · clamp((RH - 70)/30, 0, 1))
            · (1 - 0.30 · clamp(PM2_5 / 60, 0, 1))          # smoke/haze
            · seeing_bonus                                   # from 7Timer, ±5%

**M_moon — moon interference:**

    f_up  = fraction of observing window with Moon above horizon,
            weighted by sin(altitude) (moon low ≈ less sky glow)
    I     = illuminated fraction (0..1)
    M_moon = 1 - 0.88 · f_up · I^1.4

A 20% crescent barely matters; a full moon up all night ≈ 0.12.

**H_open — horizon openness / terrain & canopy:**

    horizon profile h(az) sampled every 10° from DEM within 20 km
    blocked = fraction of azimuths with horizon elevation > 12°
    H_open = (1 - 0.6·blocked) · (1 - 0.5·canopy_fraction_200m)
             · elevation_bonus                # +up to 8% for being above haze layer

Also compute **directional quality**: if the south sky (Milky Way core in N.
hemisphere) is blocked, penalize harder — `H_open` uses 1.5× weight on the
southern quadrant azimuths 135°–225° (N. hemisphere; mirrored in S.).

**A_access — practical accessibility:**

    Start at 1.0 and multiply:
      × 0.55 if no public road within 400 m
      × 0.75 if no legal parking / pull-off identified
      × 0.85 if last road segment is unpaved (surface=dirt/gravel/ground)
      × 0.60 if inside access=private / no public access
      × 0.90 if gate/opening_hours closes before the observing window ends
      × 1.05 if certified Dark Sky Place (curated, safe, expected)

### 4.2 The observing window
    window_start = max(astronomical_dusk, user_earliest_departure + drive)
    window_end   = min(astronomical_dawn, user_bedtime - drive_home)
If `window_end - window_start < 45 min` → verdict is capped at MAYBE with reason
"not enough dark time tonight."

### 4.3 Worth It `W` — is the drive justified?

    ΔQ  = Q_site - Q_home                       # marginal gain over your backyard
    t_d = one-way drive minutes
    t_o = planned observing minutes (default 90)

    time_efficiency = ΔQ · t_o / (2·t_d + t_o)
    fuel_cost_pts   = κ · (2 · dist_km / 100 · L_per_100km · price) # default κ small
    fatigue_pts     = φ · max(0, (arrive_home - bedtime) in hours)

    W = time_efficiency - fuel_cost_pts - fatigue_pts

Defaults: `κ = 0.8 pts per unit currency`, `φ = 4 pts/hour late`,
`L_per_100km = 8`, price from a user setting (no API — user types it once).

**Why this form:** `t_o / (2·t_d + t_o)` is the fraction of committed time you
actually spend observing — a real, explainable quantity ("you'd spend 62% of the
trip under the stars"). It naturally makes long drives acceptable when you plan a
long session, and unacceptable for a 30-minute peek. This is the formula the
user's "what's worth it" intuition is reaching for.

### 4.4 Verdict thresholds

| Condition | Verdict |
|---|---|
| `W ≥ 12` and `C_cloud ≥ 0.55` | **GO** |
| `W ≥ 4` | **MAYBE** |
| `W < 4` or `C_cloud < 0.25` | **STAY HOME** |
| `Q_home ≥ 0.8 · Q_best` | **STAY HOME — your backyard is nearly as good tonight** |

Every verdict must render **2–4 plain-language reason chips**, e.g.
`Bortle 3 (you're at 6)` · `52 min drive` · `18% cloud after 11pm` ·
`Moon sets 10:41pm` · `Dew risk — bring a shield`.

### 4.5 Forecast confidence & "better night"
- Query **Open-Meteo Ensemble API** for cloud cover; compute member spread.
  `confidence = 1 - normalized_stddev` → badge High/Medium/Low.
- Score the **next 5 nights** for the best site (cheap: one batched call).
- If `max(W_future) > 1.35 · W_tonight`, show:
  **"Wait for Thursday — clearer and the Moon sets at 9pm."**
  This is a trust-building feature: an app willing to tell you *not* to go is one
  you believe when it says go.

---

## 5. Feature: "Tonight" panel (always visible)

A single horizontal **hour-by-hour ribbon** for the selected site, 6pm → 6am:
- Row 1: darkness state (daylight / civil / nautical / **astronomical dark**)
- Row 2: cloud stack (stacked low/mid/high bars)
- Row 3: Moon altitude + illumination
- Row 4: combined **"go-ability"** heat strip (`C_cloud · M_moon · T_trans`)
- Highlighted: **best window** (contiguous max-integral block)

Below it, condition cards:
| Card | Data |
|---|---|
| Milky Way | Galactic-core altitude + best hour; "core rises 1:12am, peaks 28°" |
| Moon | Phase icon, illum %, rise/set, "next new moon in 6 days" |
| Transparency | AOD, smoke/dust warning, 7Timer transparency band |
| Seeing | 7Timer arcsec band (for scope users) |
| Comfort | Temp at 1am **at the site** (not at home), wind, dew point → dew/fog/frost warnings |
| Aurora | NOAA SWPC Kp — show only if Kp ≥ 4 and lat is plausible |
| Meteors | Static shower table (Perseids/Geminids/etc.) with ZHR + radiant altitude |

---

## 6. Snapping: from a grid cell to a place you can actually stand

Given a raw candidate cell, search a 2.5 km radius (Overpass, cached):

**Preferred targets, in scoring order**
1. `tourism=viewpoint`, `natural=peak` with access
2. `amenity=parking` (`access` ∈ yes/public/permissive) — esp. trailhead lots
3. `highway=rest_area` / `services`
4. `leisure=park|nature_reserve|recreation_ground|pitch` (open subtypes only)
5. `landuse=meadow|grass|farmland(edge)`, `natural=grassland|heath|scrub|beach`
6. Boat ramps, fishing access, lake/reservoir shorelines (open S horizon over water)
7. `highway=track|unclassified` **dead-end terminus** with `access!=private`
   → classic pull-off; flag as "roadside pull-off, verify legality"
8. Cemeteries, fairgrounds, school athletic fields (flag "check local rules")

**Hard excludes:** `access=private|no`, military, airports, active quarries,
anything within 250 m of a mapped `highway=street_lamp` cluster or a
`landuse=industrial`, and anything with `barrier=gate` + `locked=yes` on approach.

**Snap score** = `0.45·openness + 0.25·(1 - Δdarkness) + 0.20·parking_quality
+ 0.10·(1 - dist/2500)` where `openness` uses OSM canopy polygons and (phase 3)
a coarse tree-cover raster.

**Output for every result:**
- Name (or "Unnamed pull-off on Forest Rd 218")
- Coordinates (copyable, DD + DMS)
- **Deep links**: Google Maps directions, Apple Maps, Waze, geo: URI
  (deep links only — **never** the paid Maps Platform APIs)
- What3Words-style plain description generated from OSM context
- Photo: none (no free imagery API without cost) — instead show a
  **MapLibre 3D terrain mini-view** with the horizon profile ring

---

## 7. UX / Screens

### 7.1 Information architecture

/ Home = Verdict (Mode 2), auto-run on load
/search Mode 1 & 3 with the filter rail
/map Full-screen explore: LP layer + isochrone + sites
/site/[id] Site detail: Tonight panel, horizon ring, logs, directions
/saved Saved spots + trip log
/settings Units, patience defaults, bedtime, fuel, red-light mode
/about Data sources, attribution, methodology, LP explainer


### 7.2 Design principles
1. **Answer first.** The home screen shows a verdict within 2 s of geolocation,
   before the map even finishes loading. Skeleton the map, not the answer.
2. **Red-light night mode.** A true dark-adaptation theme: monochrome red on
   black, no white pixels, brightness slider, large tap targets for cold hands
   and gloves. Auto-suggest at astronomical dusk. This is a *field* app.
3. **One number, then the depth.** Casual users see "Bortle 4 · 38 min · GO".
   Power users expand to SQM, radiance, AOD, seeing, horizon profile.
4. **Never lie about certainty.** Every modeled value gets a provenance tooltip
   and a date. Confidence badges on all forecasts.
5. **Offline-first for the field.** Destinations have no cell service. See §8.

### 7.3 Map layer stack (MapLibre GL JS)
- Basemap: **OpenFreeMap `dark`** (or `fiord`); user can switch to `positron`.
- Light-pollution raster: our PMTiles/COG, viridis-inverse or the classic LP
  color ramp, opacity slider, **legend that shows both Bortle and SQM**.
- Isochrone polygon (Mode 3), semi-transparent.
- IDSP boundaries (CC BY 4.0 attribution required).
- Public lands (PAD-US), toggle.
- Candidate markers, ranked & numbered; the winner is visually dominant.
- Optional: NASA GIBS Black Marble tiles as a "latest pass" comparison layer.
- Optional: 3D terrain (AWS terrarium tiles) for horizon assessment.

---

## 8. Technical Architecture

### 8.1 Stack (all free tiers)
| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.3** (App Router, RSC) + **React 19** + **TypeScript strict** | Route Handlers give us a free BFF for API-key hiding, caching, and CORS. |
| Styling | **Tailwind CSS v4** + **shadcn/ui** | Fast, themeable (needed for red-light mode). |
| Map | **MapLibre GL JS v5** + OpenFreeMap | No key, no quota, open styles. |
| State/data | **TanStack Query v5** + Zustand for UI state | Caching, retries, stale-while-revalidate. |
| Geo | `@turf/turf`, `pmtiles`, `geotiff.js`, `h3-js` (candidate dedup) | |
| Astronomy | **`astronomy-engine`** (MIT) | Local Moon/Sun/twilight/galactic-core math. Zero API calls, works offline. |
| Storage | **Cloudflare R2** for rasters (free tier, no egress fees) | Rasters are static blobs; R2's zero-egress is the key advantage. |
| DB | Phase 1: **local-first** (IndexedDB via Dexie). Phase 3: **Cloudflare D1** or Supabase free | Avoids all backend cost until accounts are needed. |
| Hosting | **Cloudflare Workers/Pages** (preferred) or **Vercel Hobby** | Note: Vercel Hobby forbids commercial use — fine for personal, revisit if monetizing. |
| PWA | `next-pwa`/custom service worker + Workbox | Offline field mode. |
| Mobile (phase 4) | **Capacitor** wrapper over the PWA | Reuses 100% of the web app; native geolocation + notifications. |
| Testing | **Vitest** (unit, esp. scoring), **Playwright** (e2e) | Scoring math must be unit-tested with fixtures. |
| Pipeline | **Python 3.12** + `rasterio`/`numpy`/`scipy`/`gdal` (uv-managed) | Offline, run a few times a year. |

### 8.2 Offline data pipeline (`/pipeline`, run manually/annually)

    fetch_viirs.py Download VNL V2.x annual (public domain) + monthly.
    build_skyglow.py Convolve upward radiance with a Walker's-law /
    Garstang-style propagation kernel:
    b_art(x) = k · Σ_i R_i · A_i · d_i^-2.5 · exp(-d_i/H)
    implemented as an FFT convolution with a radial kernel
    (H ≈ 40 km scale height, kernel radius 300 km).
    Calibrate k against (a) published SQM measurements and
    (b) the Lorenz atlas, minimizing RMSE. Store residuals.
    quantize.py SQM → uint8: v = round((SQM - 16.0) · 20) → 0.05 mag steps
    make_tiles.py Emit PMTiles raster (z0–z10) + a COG for point queries.
    distance_transform.py For each threshold (19.5, 20.5, 21.7, 21.9):
    scipy EDT → distance + bearing rasters (uint16/uint8).
    build_places.py IDSP shapefile + PAD-US + observatories → GeoJSON/PMTiles.
    validate.py Assert conversions, spot-check 50 known SQM sites.

Outputs are versioned (`/data/v2026.1/…`) and uploaded to R2. **Never commit
rasters to git** — use a `data.lock.json` manifest with URLs + checksums.

> **Size budget:** CONUS @ 1 km ≈ 4,700 × 2,600 uint8 ≈ **12 MB**. Comfortably
> static-hostable. Global @ 1 km is ~600 MB → tile it, ship CONUS first.

### 8.3 Runtime API surface (Next.js Route Handlers)
| Route | Purpose | Cache |
|---|---|---|
| `GET /api/darkness?lat&lon` | Point SQM/Bortle/radiance + provenance | 30 d, immutable |
| `POST /api/candidates` | Body: origin, mode, threshold, budget, filters → ranked scored sites | 1 h by rounded key |
| `GET /api/isochrone?lat&lon&minutes` | Valhalla proxy | 24 h |
| `POST /api/matrix` | Valhalla `sources_to_targets` proxy | 6 h |
| `GET /api/conditions?points=…` | Open-Meteo (batched multi-coord) + AQ + 7Timer, merged | 20 min |
| `GET /api/places?bbox&types` | Overpass proxy w/ normalization | 7 d |
| `GET /api/horizon?lat&lon` | DEM horizon profile (36 azimuths) | 90 d |
| `GET /api/verdict?…` | Full Mode-2 pipeline, returns verdict + reasons | 15 min |

All upstream calls go through `lib/upstream/` with: timeout, retry w/ jitter,
circuit breaker, per-provider rate limiter, and **graceful degradation**
(if 7Timer is down, drop `seeing_bonus` to 1.0 and mark data partial —
never fail the whole request).

### 8.4 Performance targets
- Verdict rendered ≤ **2.0 s** p75 on 4G after location grant.
- Mode 3 (isochrone) ≤ **5 s** p75.
- ≤ **1 Valhalla matrix call**, ≤ **2 Open-Meteo calls**, ≤ **1 Overpass call**
  per user search (batching is mandatory, not optional).
- Lighthouse ≥ 95 perf/a11y. Initial JS ≤ 250 KB gzip excl. MapLibre (lazy-load
  the map).

---

## 9. Data Sources — Registry & Attribution

| Source | Use | Licence / cost | Attribution requirement |
|---|---|---|---|
| VIIRS VNL V2.x annual+monthly (EOG, Colorado School of Mines) | Base LP data | **Public domain**, free | Cite EOG/Payne Institute (courtesy) |
| NASA Black Marble VNP46A1/A2 NRT | "Latest pass" layer | Free (Earthdata login) | NASA credit |
| NASA GIBS WMTS | Day/night band tiles | Free, no key | NASA GIBS credit |
| Lorenz Light Pollution Atlas (2025) | Model calibration + optional reference layer | Free, **email the author before republishing tiles**; do NOT label as Bortle | Credit David Lorenz |
| Falchi et al. 2016 World Atlas (GFZ) | Validation only | **Licence request required** — do not ship | — |
| DarkSky IDSP boundaries (Spinner et al. 2024, GFZ) | Certified places | **CC BY 4.0** | Full citation |
| PAD-US (USGS) | Public land | Public domain | USGS credit |
| OpenStreetMap via Overpass | Parking, green space, roads, gates | **ODbL** | "© OpenStreetMap contributors" |
| OpenFreeMap | Basemap tiles | Free, no limits | Auto-added by MapLibre |
| Open-Meteo (Forecast, AQ, Ensemble, Elevation, Geocoding) | Conditions | Free non-commercial, **CC BY 4.0**, no key, 10k/day | "Weather data by Open-Meteo.com" |
| 7Timer! ASTRO | Seeing/transparency | Free non-commercial | Credit 7Timer! |
| Valhalla @ FOSSGIS | Isochrone/matrix/route | Free demo, **fair use** — send `X-Client-Id: darkward.app`, notify via GitHub Discussions | Credit FOSSGIS e.V. + OSM |
| AWS Terrain Tiles (terrarium) | DEM/horizon | Free, no key | Credit Mapzen/AWS/contributors |
| NOAA SWPC | Aurora Kp | Public domain | NOAA credit |

**An `/about` page listing all of the above is a launch blocker**, not a nice-to-have.

---

## 10. Roadmap

### Phase 0 — Data foundation (week 1)
- [ ] Pipeline scripts 1–5 for **CONUS only**; publish `v2026.1` to R2.
- [ ] `lib/darkness/convert.ts` + `lib/scoring/*` fully unit-tested against fixtures.
- [ ] Validate 50 known-SQM sites, RMSE < 0.4 mag or iterate the kernel.

### Phase 1 — MVP web app (weeks 2–3) ← *ship this*
- [ ] Geolocation + manual location search (Open-Meteo geocoding).
- [ ] `/api/darkness` point lookup; "you are at Bortle 6 (SQM 19.1)".
- [ ] **Mode 1** (threshold → nearest, drive-time ranked, snapped).
- [ ] Tonight panel (clouds, moon, astro-dark window) + **GO/MAYBE/STAY HOME**.
- [ ] MapLibre map w/ LP raster + result markers + Google/Apple deep links.
- [ ] Red-light night mode. Mobile-first responsive.

### Phase 2 — Intelligence (weeks 4–5)
- [ ] **Mode 3** isochrone time-budget search.
- [ ] **Mode 2** full Worth-It optimizer + "better night is ___".
- [ ] Transparency/AOD, seeing, dew/fog/wind warnings, ensemble confidence.
- [ ] Horizon openness from DEM; horizon ring visual.
- [ ] IDSP + public land layers & filters.

### Phase 3 — Field-ready & sticky (weeks 6–8)
- [ ] PWA offline: cache the plan, map tiles for the route, all ephemeris local.
- [ ] Saved spots + trip log + community SQM submissions + spot ratings.
- [ ] "Alert me when a clear + moonless night is coming" (web push).
- [ ] Milky Way / meteor shower / aurora modules.
- [ ] Global data coverage beyond CONUS.

### Phase 4 — Mobile (weeks 9+)
- [ ] Capacitor wrap, native geolocation/notifications, App Store/Play.
- [ ] Optional: compass/AR horizon check on-site; live SQM-by-camera experiment.

---

## 11. Constraints, Risks, Mitigations

| Risk | Mitigation |
|---|---|
| **$0 budget is a hard requirement** | No provider requiring a card. Every upstream has a documented free tier. Self-hosted rasters on R2. If a free tier dies, the app degrades, never breaks. |
| FOSSGIS Valhalla fair-use / rate limits | Aggressive caching, `X-Client-Id`, request coalescing, quantized origins, exponential backoff. Fallback: straight-line × 1.35 road-factor estimate, clearly labeled "estimated". Document the self-host path (Docker + regional OSM extract) as the escape hatch. |
| Open-Meteo 10k/day non-commercial | Batch multi-coordinate calls, 20-min cache, client-side cache. Monitor with a counter. |
| Overpass instability | 7-day cache, secondary endpoint, precomputed candidate spots for popular metro areas. |
| Model accuracy claims | Show provenance + uncertainty everywhere; publish methodology on `/about`; community SQM readings as ground truth. |
| **Safety/liability** — sending people to remote roads at night | Persistent field-safety notice; "verify legality/access before going"; flag unpaved/gated/private; encourage telling someone your plan; never suggest spots on active roadway shoulders. |
| Trespassing | Hard-exclude `access=private`; label uncertain spots "verify access". |
| Privacy | Location stays client-side by default; API calls use **rounded coordinates** (3 dp) ; no accounts in Phase 1; no third-party analytics beyond a self-hosted/privacy-first option. |

---

## 12. Success Metrics
- **Primary:** % of sessions ending in a "GO" with a tapped directions link (intent-to-act).
- Verdict → depart conversion; return visits within 30 days.
- Trip logs created / spots rated (ground-truth flywheel).
- **Trust metric:** ratio of users who return after a "STAY HOME" verdict — if
  high, the honesty strategy is working.
- Technical: p75 verdict latency, upstream error rate, cache hit rate ≥ 80%.

---

## 13. Open Questions
1. Ship CONUS-only first, or accept coarser global data day one?
2. Do we let users adjust scoring weights ("I hate driving" / "clouds ruin it"),
   or keep one opinionated model? (Lean: presets, not sliders, in v1.)
3. Community SQM submissions — moderation burden vs. value?
4. Is a "route mode" (best dark site along a planned drive) a Phase 3 or a
   differentiating Phase 2 feature?