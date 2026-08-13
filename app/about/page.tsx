import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About & Attribution — Skyward",
  description:
    "Data sources, methodology, and attribution for Skyward, the dark-sky trip planner.",
};

const SOURCES = [
  {
    name: "Open-Meteo",
    usage: "Cloud cover, temperature, wind, humidity, and air-quality data.",
    licence: "CC BY 4.0 (non-commercial)",
    note: "Attribution: Weather data by Open-Meteo.com. No API key required.",
  },
  {
    name: "OpenFreeMap",
    usage: "Base map tiles (dark style).",
    licence: "Open-source / free, no API key. Data © OpenStreetMap contributors (ODbL).",
  },
  {
    name: "astronomy-engine",
    usage:
      "Sun, moon, and twilight calculations computed entirely on-device (no ephemeris API).",
    licence: "MIT (library)",
  },
  {
    name: "OpenStreetMap",
    usage:
      "Planned source for access classification, parking, and site snapping (Mode 1/3).",
    licence: "ODbL",
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
        Bortle is a subjective whole-sky visual judgement. Skyward models zenith
        sky brightness and maps it to an approximate Bortle class, always shown
        with a “≈” and an explanatory note. Our modeled value is not a
        measurement of the Bortle scale.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Safety</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Skyward never recommends a spot on a road shoulder, in a travel lane, on
        private land, or behind a locked gate. Before heading out, tell someone
        your plan, pack for cold and wildlife, and expect limited cell service
        at dark-sky sites.
      </p>
    </main>
  );
}