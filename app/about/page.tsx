import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About & Attribution — Skyward",
  description:
    "Data sources, methodology, and attribution for Skyward, the dark-sky trip planner.",
};

const SOURCES = [
  {
    name: "OpenStreetMap",
    usage:
      "Site snapping, access classification, parking, roads, gates, and landcover — every candidate spot is verified against OSM tags before it is recommended.",
    licence: "ODbL",
    note: "© OpenStreetMap contributors. Data accessed via Overpass API.",
  },
  {
    name: "Open-Meteo",
    usage:
      "Cloud cover (low/mid/high), temperature, dew point, wind, humidity, and air-quality data (AOD, PM2.5). Batched multi-coordinate calls — one forecast + one AQ call per search.",
    licence: "CC BY 4.0 (non-commercial)",
    note: "Weather data by Open-Meteo.com. No API key required.",
  },
  {
    name: "OpenFreeMap",
    usage: "Base map tiles (dark style) rendered by MapLibre GL JS.",
    licence: "Open-source / free, no API key. Map data © OpenStreetMap contributors (ODbL).",
  },
  {
    name: "Valhalla (FOSSGIS e.V.)",
    usage:
      "Road-network isochrones and drive-time matrices. One isochrone + one matrix call per search; Haversine estimates used as fallback when the demo server is unavailable.",
    licence: "Fair-use demo (FOSSGIS e.V.). Self-hostable — swap VALHALLA_BASE_URL.",
    note: "Routing data © OpenStreetMap contributors. X-Client-Id: skyward.app.",
  },
  {
    name: "EOG / Payne Institute (Colorado School of Mines)",
    usage:
      "VIIRS VNL V2.x annual and monthly upward radiance composites — the base data for our modeled sky-brightness raster (Phase 0 pipeline).",
    licence: "Public domain",
    note: "Earth Observation Group, Payne Institute for Public Policy. Courtesy attribution.",
  },
  {
    name: "DarkSky International IDSP (GFZ)",
    usage:
      "Certified Dark Sky Place boundaries (Parks, Reserves, Sanctuaries, Communities, Urban Places). Used to identify curated, safe, expected-legal observing sites.",
    licence: "CC BY 4.0",
    note: "Spinner et al. 2024, GFZ Data Services. Full citation on request.",
  },
  {
    name: "astronomy-engine",
    usage:
      "Sun, moon, and twilight calculations computed entirely on-device (no ephemeris API). Works offline — essential for field use without cell service.",
    licence: "MIT (library)",
  },
  {
    name: "7Timer! ASTRO",
    usage:
      "Atmospheric seeing and transparency forecasts (planned Phase 2). Currently degraded to neutral 1.0; the response `partial` list records the gap honestly.",
    licence: "Free non-commercial",
    note: "Credit 7Timer! (planned integration).",
  },
  {
    name: "NASA Black Marble (VNP46A1/A2 NRT)",
    usage:
      "Daily 'latest pass' satellite radiance layer (planned Phase 2). Provides a noisy but near-real-time comparison to the annual model.",
    licence: "Free (Earthdata login)",
    note: "NASA GIBS / Black Marble credit (planned integration).",
  },
  {
    name: "NOAA SWPC",
    usage:
      "Aurora Kp index — shown only when Kp ≥ 4 and the user's latitude is plausible (planned Phase 2).",
    licence: "Public domain",
    note: "NOAA Space Weather Prediction Center (planned integration).",
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">About Skyward</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Skyward finds where to drive tonight for the best stargazing, and tells
        you whether it's worth going at all. Every value shown in the app
        carries its provenance — the source, vintage, and (for forecasts) a
        confidence level.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Data sources & attribution</h2>
      <p className="mt-1 text-xs text-muted-foreground/70">
        Attribution is a launch requirement. Every data source below is listed
        with its licence and usage. If a source is marked &ldquo;planned&rdquo;
        it is not yet wired; the app degrades honestly rather than fabricating
        its data.
      </p>
      <ul className="mt-3 space-y-3">
        {SOURCES.map((s) => (
          <li
            key={s.name}
            className="rounded-xl border border-border/50 bg-card/60 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.licence}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{s.usage}</p>
            {s.note && (
              <p className="mt-1 text-xs text-muted-foreground/70">{s.note}</p>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold">About “Bortle” labels</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Bortle is a subjective whole-sky visual judgement (Unihedron/Bortle).
        Skyward models zenith sky brightness and maps it to an approximate
        Bortle class, always shown with a “≈” and an explanatory note. Our
        modeled value is not a measurement of the Bortle scale — this is a
        credibility requirement, not a style preference.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Methodology</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The scoring engine multiplies six factors — darkness, cloud cover,
        atmospheric transparency, moon interference, horizon openness, and
        practical accessibility — into a single observing-quality score Q
        (0–100). A &ldquo;Worth It&rdquo; score W then subtracts fuel cost and
        fatigue from the marginal quality gain over staying home. Every
        coefficient is documented in <code>lib/scoring/config.ts</code> and
        traceable to the product spec (<code>prd.md</code> §4).
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        The darkness model (Phase 0 pipeline) convolves VIIRS upward radiance
        with a Walker&rsquo;s-law / Garstang-style atmospheric propagation
        kernel to estimate zenith artificial brightness. This is calibrated
        against published SQM measurements. The model is offline and static —
        updated annually — while sky conditions (cloud, moon, transparency) are
        what actually change night to night and are fetched live.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Safety</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Skyward never recommends a spot on a road shoulder, in a travel lane, on
        private land, or behind a locked gate. Every result card shows an access
        confidence label: Verified public, Likely public, or Verify access
        before going. Before heading out, tell someone your plan, pack for cold
        and wildlife, and expect limited cell service at dark-sky sites.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Privacy</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Precise coordinates stay on your device. Every outbound API call uses
        coordinates rounded to 3 decimal places (~110 m) — both a cache-hit
        strategy and a privacy measure. No accounts, no third-party analytics,
        no tracking cookies. The app works offline for field use: all ephemeris
        math runs locally, and saved spots live in your browser&rsquo;s
        IndexedDB.
      </p>

      <p className="mt-8 text-xs text-muted-foreground/50">
        Skyward is free and open source. Zero-cost data sources only — no paid
        APIs, no credit-card tier, no &ldquo;free trial.&rdquo; Built with
        Next.js, MapLibre GL JS, and astronomy-engine.
      </p>
    </main>
  );
}