# 🌌 Skyward — Dark Sky Trip Planner

> **"Find where to drive tonight for the best stargazing, and know if it's worth leaving the house."**

Skyward joins **darkness + legal accessibility + real road drive times + tonight's live sky conditions** into one clear, honest decision.

---

## 📖 The Story & Development of Skyward

Every amateur stargazer and astrophotographer knows the struggle:
1. You check light pollution maps (`lightpollutionmap.info`) to eyeball a dark region.
2. You wonder if any spot there is publicly accessible, safe, or has legal parking.
3. You open Google Maps to guess driving times.
4. You check weather sites (Clear Outside, Astrospheric) for cloud layers.
5. You check moonrise/moonset and twilight tables.
6. Mentally combining all these disparate signals is exhausting, and often leads to staying home or driving 2 hours only to find locked gates and fog.

**Skyward was created to solve this entire decision loop in a single tap.**

### Development Journey
- **Phase 0 — Scientific Foundation:** We codified astronomical equations (Walker's law, Garstang scattering, SQM-to-Bortle mapping, and multi-layer cloud physics) using pure TypeScript and `astronomy-engine` so calculations run instantly and work offline.
- **Phase 1 — Zero-Cost Architecture:** We designed the system from day one to operate with **$0 overhead** using public-interest and open-source data: Open-Meteo, OpenStreetMap via Overpass, Valhalla routing via FOSSGIS, and OpenFreeMap.
- **Phase 2 — Multi-factor Intelligence:** Rather than simply sorting by air distance, Skyward calculates real road-network isochrones, snaps raw grid cells to legal viewpoints and trailheads, and computes a multi-attribute ranking score balancing darkness, open horizon, natural greenery, parking, and drive time.

---

## ⚙️ How the Calculations Work

All scoring logic is pure, deterministic, unit-tested, and defined in `lib/scoring/config.ts` and `lib/search/config.ts`.

### 1. Observing Quality ($Q$) — Site Score (0–100)
Observing Quality is **multiplicative**. If any critical factor is zero (e.g. 100% overcast cloud cover), the entire trip quality drops to 0.

$$Q = 100 \cdot S_{\text{dark}} \cdot C_{\text{cloud}} \cdot T_{\text{trans}} \cdot M_{\text{moon}} \cdot H_{\text{open}} \cdot A_{\text{access}}$$

- **$S_{\text{dark}}$ (Darkness Factor):** $\text{clamp}\left(\frac{\text{SQM} - 17.5}{21.95 - 17.5}, 0, 1\right)^{0.85}$ modeled as zenith sky brightness in $\text{mag}/\text{arcsec}^2$.
- **$C_{\text{cloud}}$ (Layered Cloud Cover):** Layer-weighted visibility: $(1 - c_{\text{low}})^{1.0} \cdot (1 - c_{\text{mid}})^{0.85} \cdot (1 - c_{\text{high}})^{0.55}$, with dew-spread penalties for fog.
- **$T_{\text{trans}}$ (Atmospheric Transparency):** Exponential aerosol optical depth decay ($\text{AOD}_{550}$), relative humidity, and $\text{PM}_{2.5}$ haze.
- **$M_{\text{moon}}$ (Lunar Glow Factor):** Penalizes based on lunar illumination fraction and moon altitude above horizon: $1 - 0.88 \cdot f_{\text{up}} \cdot I^{1.4}$.
- **$H_{\text{open}}$ (Horizon Openness):** Evaluates unobstructed 360° sky visibility and terrain/canopy clearance, with 1.5× weight on the southern quadrant for Milky Way core viewing.
- **$A_{\text{access}}$ (Accessibility & Legality):** Multipliers for verified public access, dedicated parking/trailheads, paved roads, and verified opening hours.

---

### 2. "Worth It" Equation ($W$) — Trip Justification
The Worth-It formula determines whether the marginal observing quality gained by driving justifies the travel time, fuel, and fatigue:

$$\Delta Q = Q_{\text{site}} - Q_{\text{home}}$$

$$\text{Time Efficiency} = \Delta Q \cdot \frac{t_{\text{observing}}}{2 \cdot t_{\text{drive}} + t_{\text{observing}}}$$

$$W = \text{Time Efficiency} - \text{Fuel Penalty} - \text{Fatigue Penalty}$$

- **Verdict Outcomes:**
  - $W \ge 12$ and $C_{\text{cloud}} \ge 0.55 \implies$ **GO** 🟢
  - $W \ge 4 \implies$ **MAYBE** 🟡
  - $W < 4$ or $C_{\text{cloud}} < 0.25 \implies$ **STAY HOME** 🔴
  - If $Q_{\text{home}} \ge 0.8 \cdot Q_{\text{best}} \implies$ **STAY HOME (Backyard is nearly as good tonight)**

---

### 3. Openness vs. Greenery
Skyward distinguishes between **Openness** and **Natural Greenery**:
- **Openness (Horizon Visibility):** Quantifies clear 360° sightlines without hill or dense tree obstruction, essential for viewing astronomical objects near the horizon (such as the galactic core or planetary conjunctions).
- **Greenery (Nature & Scenic Setting):** Scores site environment, prioritizing state and national parks, wilderness reserves, and grassy fields over commercial parking lots or roadside asphalt.

---

### 4. Darkness & Bortle Approximation
- **Zenith SQM ($\text{mag}/\text{arcsec}^2$):** Continuous physical metric from 16.0 (light-polluted city) to 22.0 (natural dark sky).
- **Approximate Bortle Scale (1–9):** Lower numbers mean darker skies.
  - **Bortle 1:** $\ge 21.99$ (Pristine dark sky)
  - **Bortle 2:** $21.89 - 21.99$ (Truly dark sky)
  - **Bortle 3:** $21.69 - 21.89$ (Rural sky)
  - **Bortle 4:** $20.49 - 21.69$ (Rural/suburban transition)
  - **Bortle 5–9:** $\le 20.49$ (Suburban to Inner-city sky)
- **Credibility Standard:** Bortle is a subjective whole-sky visual judgement; Skyward models zenith brightness and presents values as `≈ Bortle N` with explicit provenance.

---

## 🛠️ Architecture & Codebase Map

```
Skyward/
├── app/
│   ├── page.tsx               # Primary interface (Mode 1 & Mode 3 trip search)
│   ├── layout.tsx             # Root layout & providers
│   ├── globals.css            # Tailwind theme tokens & MapLibre styling
│   ├── about/page.tsx         # Data attribution, licences, and methodology
│   └── api/
│       ├── candidates/route.ts# Search endpoint (Threshold & Time-Budget modes)
│       ├── conditions/route.ts# Batched weather, moon, and air quality
│       └── verdict/route.ts   # Mode 2 worth-it engine
├── components/
│   ├── HomeShell.tsx          # Full-screen responsive shell, filters & results
│   ├── map/
│   │   └── MapView.tsx        # MapLibre GL map, markers, isochrones & heatmap
│   └── tonight/
│       └── HourRibbon.tsx     # Hourly sky timeline, dark window & peak times
├── lib/
│   ├── astronomy/             # Local ephemeris (Sun/Moon/twilight math)
│   ├── darkness/              # SQM, Bortle, and NELM conversions
│   ├── geo/                   # Haversine distance, bearings, and deep links
│   ├── scoring/               # Q, W, observing window, and verdict math
│   ├── search/                # Snapping, ranking, isochrones, and matrix
│   ├── types/                 # TypeScript interfaces and Zod schemas
│   └── upstream/              # Zero-cost API clients (Open-Meteo, Valhalla, Overpass)
└── tests/
    ├── unit/                  # Vitest unit test suite (scoring, darkness, ephemeris)
    └── e2e/                   # Playwright end-to-end smoke tests
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ (Node 22 recommended)
- `pnpm` (or `npm`/`yarn`)

### Installation & Local Setup

```bash
# Clone repository
git clone https://github.com/your-repo/skyward.git
cd skyward

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Running Tests

```bash
# Run unit tests with Vitest
pnpm test

# Run build check
pnpm build

# Run end-to-end tests with Playwright
pnpm test:e2e
```

---

## 📜 Licences & Upstream Attribution

Skyward is built strictly with zero-cost and open-source data sources:
- **OpenStreetMap & Overpass:** © OpenStreetMap contributors (ODbL)
- **Open-Meteo:** Weather and Air Quality data (CC BY 4.0)
- **OpenFreeMap:** Base map vector tiles
- **Valhalla @ FOSSGIS e.V.:** Isochrone and travel time routing (ODbL)
- **astronomy-engine:** Ephemeris and solar system calculations (MIT)
- **DarkSky International:** Certified Dark Sky Place boundaries (CC BY 4.0)
- **VIIRS / Earth Observation Group:** Upward radiance satellite data (Public Domain)