/**
 * Required scoring fixtures (.clinerules §6):
 * Bortle 2 desert · Bortle 8 urban · full-moon overcast · new-moon clear ·
 * canyon-blocked horizon · gated park.
 *
 * These fixtures drive the snapshot tests in tests/unit so any tuning change
 * shows up in the diff and is reviewed intentionally.
 */

import type {
  AccessInput,
  CloudLayerHour,
  MoonHour,
} from "@/lib/types/scoring";
import type { QualityInput } from "@/lib/scoring/quality";

/** Open, treeless, perfect-horizon site. */
export const OPEN_ACCESS: AccessInput = {
  hasPublicRoadWithin400m: true,
  hasLegalParking: true,
  lastRoadUnpaved: false,
  accessPrivateOrNo: false,
  closesBeforeWindowEnd: false,
  certifiedDarkSkyPlace: false,
};

/** 36 azimuths at 10° each, all at 0° elevation (flat horizon). */
export const FLAT_HORIZON: readonly number[] = Array.from({ length: 36 }, () => 0);

/** Canyon site: southern quadrant blocked by 25° walls. */
export const CANYON_HORIZON: readonly number[] = Array.from({ length: 36 }, (_, i) => {
  const az = i * 10;
  const isSouth = az >= 135 && az < 225;
  return isSouth ? 25 : 5;
});

/** Gated park: gate closes before the window ends. */
export const GATED_PARK_ACCESS: AccessInput = {
  ...OPEN_ACCESS,
  closesBeforeWindowEnd: true,
};

interface Fixture {
  name: string;
  quality: QualityInput;
  /** C_cloud factor value, asserted separately. */
  cloudFactor: number;
  /** Q_home reference for verdict tests (ignored by quality snapshots). */
  qHome: number;
}

const CLEAR_HOURS: readonly CloudLayerHour[] = [
  { cloudLowFrac: 0.02, cloudMidFrac: 0.05, cloudHighFrac: 0.05 },
  { cloudLowFrac: 0.02, cloudMidFrac: 0.05, cloudHighFrac: 0.05 },
  { cloudLowFrac: 0.05, cloudMidFrac: 0.08, cloudHighFrac: 0.1 },
];

const OVERCAST_HOURS: readonly CloudLayerHour[] = [
  { cloudLowFrac: 0.95, cloudMidFrac: 0.8, cloudHighFrac: 0.6 },
  { cloudLowFrac: 0.98, cloudMidFrac: 0.85, cloudHighFrac: 0.65 },
  { cloudLowFrac: 0.9, cloudMidFrac: 0.75, cloudHighFrac: 0.55 },
];

const NEW_MOON_HOURS: readonly MoonHour[] = [
  { altitudeDeg: 40, illumFrac: 0.02 },
  { altitudeDeg: 45, illumFrac: 0.02 },
];

const FULL_MOON_HOURS: readonly MoonHour[] = [
  { altitudeDeg: 60, illumFrac: 0.99 },
  { altitudeDeg: 62, illumFrac: 0.99 },
];

/** Bortle 2 desert: SQM ~21.9, clear, new moon, flat horizon, open access. */
export const BORTLE_2_DESERT: Fixture = {
  name: "bortle-2-desert",
  qHome: 18,
  quality: {
    sqmMpsas: 21.9,
    cloudHours: CLEAR_HOURS,
    transparency: { aod550: 0.04, relHumidityPct: 30, pm25UgM3: 2, seeingBonus: 1.0 },
    moonHours: NEW_MOON_HOURS,
    horizon: {
      horizonElevDeg: FLAT_HORIZON,
      canopyFraction200m: 0.01,
      elevationM: 800,
      hemisphere: "north",
    },
    access: OPEN_ACCESS,
  },
  cloudFactor: 0.9,
};

/** Bortle 8 urban: SQM ~18.0, clear, new moon, flat horizon, open access. */
export const BORTLE_8_URBAN: Fixture = {
  name: "bortle-8-urban",
  qHome: 18,
  quality: {
    sqmMpsas: 18.0,
    cloudHours: CLEAR_HOURS,
    transparency: { aod550: 0.2, relHumidityPct: 60, pm25UgM3: 18, seeingBonus: 1.0 },
    moonHours: NEW_MOON_HOURS,
    horizon: {
      horizonElevDeg: FLAT_HORIZON,
      canopyFraction200m: 0.2,
      elevationM: 20,
      hemisphere: "north",
    },
    access: OPEN_ACCESS,
  },
  cloudFactor: 0.9,
};

/** Full moon overcast: worst case — full moon up all night + complete overcast. */
export const FULL_MOON_OVERCAST: Fixture = {
  name: "full-moon-overcast",
  qHome: 8,
  quality: {
    sqmMpsas: 21.9,
    cloudHours: OVERCAST_HOURS,
    transparency: { aod550: 0.08, relHumidityPct: 85, pm25UgM3: 5, seeingBonus: 0.95 },
    moonHours: FULL_MOON_HOURS,
    horizon: {
      horizonElevDeg: FLAT_HORIZON,
      canopyFraction200m: 0.05,
      elevationM: 100,
      hemisphere: "north",
    },
    access: OPEN_ACCESS,
  },
  cloudFactor: 0.05,
};

/** New moon clear: best case — moonless, fully clear, dark desert. */
export const NEW_MOON_CLEAR: Fixture = {
  name: "new-moon-clear",
  qHome: 14,
  quality: {
    sqmMpsas: 21.95,
    cloudHours: [
      { cloudLowFrac: 0, cloudMidFrac: 0, cloudHighFrac: 0 },
      { cloudLowFrac: 0, cloudMidFrac: 0, cloudHighFrac: 0.02 },
    ],
    transparency: { aod550: 0.03, relHumidityPct: 25, pm25UgM3: 1, seeingBonus: 1.05 },
    moonHours: [
      // Moon below horizon the entire window.
      { altitudeDeg: -20, illumFrac: 0.01 },
      { altitudeDeg: -25, illumFrac: 0.01 },
    ],
    horizon: {
      horizonElevDeg: FLAT_HORIZON,
      canopyFraction200m: 0,
      elevationM: 1200,
      hemisphere: "north",
    },
    access: OPEN_ACCESS,
  },
  cloudFactor: 1.0,
};

/** Canyon-blocked horizon: southern sky blocked by 25° walls. */
export const CANYON_BLOCKED_HORIZON: Fixture = {
  name: "canyon-blocked-horizon",
  qHome: 14,
  quality: {
    sqmMpsas: 21.9,
    cloudHours: CLEAR_HOURS,
    transparency: { aod550: 0.04, relHumidityPct: 35, pm25UgM3: 2, seeingBonus: 1.0 },
    moonHours: NEW_MOON_HOURS,
    horizon: {
      horizonElevDeg: CANYON_HORIZON,
      canopyFraction200m: 0,
      elevationM: 500,
      hemisphere: "north",
    },
    access: OPEN_ACCESS,
  },
  cloudFactor: 0.9,
};

/** Gated park: otherwise good, but the gate closes before the window ends. */
export const GATED_PARK: Fixture = {
  name: "gated-park",
  qHome: 14,
  quality: {
    sqmMpsas: 21.5,
    cloudHours: CLEAR_HOURS,
    transparency: { aod550: 0.04, relHumidityPct: 40, pm25UgM3: 3, seeingBonus: 1.0 },
    moonHours: NEW_MOON_HOURS,
    horizon: {
      horizonElevDeg: FLAT_HORIZON,
      canopyFraction200m: 0.1,
      elevationM: 200,
      hemisphere: "north",
    },
    access: GATED_PARK_ACCESS,
  },
  cloudFactor: 0.9,
};

export const FIXTURES: readonly Fixture[] = [
  BORTLE_2_DESERT,
  BORTLE_8_URBAN,
  FULL_MOON_OVERCAST,
  NEW_MOON_CLEAR,
  CANYON_BLOCKED_HORIZON,
  GATED_PARK,
];
