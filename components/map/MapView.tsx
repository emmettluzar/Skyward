"use client";

import { useEffect, useRef, type FC } from "react";
import {
  Map,
  NavigationControl,
  GeolocateControl,
  Marker,
  Popup,
  type LngLatLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CandidateSpot, GeoJsonFeatureCollection } from "@/lib/types/places";
import { useTheme } from "@/components/theme-provider";

/**
 * OpenFreeMap dark style URL.
 * Free, no API key required. Attribution auto-added by MapLibre.
 */
const OPENFREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

/**
 * Default center: roughly central US (lat 39.8, lng -98.6).
 * If geolocation fails, the map falls back here.
 */
const DEFAULT_CENTER: [number, number] = [-98.6, 39.8];
const DEFAULT_ZOOM = 4;

/** Marker + isochrone colors. Dark theme uses Skyward's blue; red theme is
  * monochrome red so no white/blue pixels leak into the field theme.
  * MapLibre GL JS does not support oklch() — hex equivalents below. */
const COLORS = {
  dark: {
    markerPrimary: "#5b9ef5",
    markerSecondary: "#3a6fc7",
    markerBorder: "#ffffff",
    markerText: "#ffffff",
    isochroneFill: "#5b9ef5",
  },
  red: {
    markerPrimary: "#c7523b",
    markerSecondary: "#963d2c",
    markerBorder: "#0f0f0f",
    markerText: "#141414",
    isochroneFill: "#b34934",
  },
} as const;

export interface MapViewProps {
  /** Called when the user's location is first obtained (or fallback). */
  onLocationReady?: (lat: number, lng: number) => void;
  /** Optional className for the container div. */
  className?: string;
  /** Candidate spots to display as markers. */
  spots?: CandidateSpot[];
  /** Isochrone GeoJSON to draw on the map. */
  isochrone?: GeoJsonFeatureCollection | null;
  /** Optional map center override (e.g. from a search result). */
  center?: [number, number];
  /** Called when a marker is clicked, with the spot for the detail pane. */
  onSpotSelect?: (spot: CandidateSpot) => void;
}

const MapView: FC<MapViewProps> = ({
  onLocationReady,
  className,
  spots,
  isochrone,
  center,
  onSpotSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const locationCalledRef = useRef(false);
  const markersRef = useRef<Marker[]>([]);
  const { theme } = useTheme();
  const isRed = theme === "red";
  const palette = COLORS[isRed ? "red" : "dark"];

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: OPENFREE_MAP_STYLE,
      center: center ?? DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    // Add navigation controls (zoom +/- and compass)
    map.addControl(new NavigationControl(), "top-right");

    // Add geolocate control to find user
    const geolocate = new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        timeout: 10000,
      },
      trackUserLocation: false,
      showUserLocation: true,
      showAccuracyCircle: false,
    });
    map.addControl(geolocate, "bottom-right");

    // When user location is obtained, center map and notify parent
    const onGeolocate = (e: unknown) => {
      const pos = e as GeolocationPosition;
      const { latitude, longitude } = pos.coords;
      map.flyTo({ center: [longitude, latitude], zoom: 10 });

      if (!locationCalledRef.current) {
        locationCalledRef.current = true;
        onLocationReady?.(latitude, longitude);
      }
    };

    // Fallback: if geolocation fails, notify with default location
    const onGeolocateError = () => {
      if (!locationCalledRef.current) {
        locationCalledRef.current = true;
        onLocationReady?.(DEFAULT_CENTER[1], DEFAULT_CENTER[0]);
      }
    };

    // Listen on the geolocate control, not the map
    geolocate.on("geolocate", onGeolocate);
    geolocate.on("error", onGeolocateError);

    // Handle missing sprite images from the OpenFreeMap style (e.g. "circle-11",
    // "wood-pattern"). We generate a tiny 1×1 transparent PNG as a fallback so
    // MapLibre doesn't spam the console.
    map.on("styleimagemissing", (e: { id: string }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
      }
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
    });

    // Trigger geolocation once style loads
    map.on("style.load", () => {
      geolocate.trigger();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle resize when parent layout changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => map.resize();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Recenter when `center` prop changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.flyTo({ center: center as LngLatLike, zoom: 10 });
  }, [center]);

  // Place candidate markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous markers.
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    if (!spots || spots.length === 0) return;

    for (const spot of spots) {
      const isPrimary = spot.rank === 1;
      const fill = isPrimary ? palette.markerPrimary : palette.markerSecondary;

      const el = document.createElement("div");
      el.className = "candidate-marker";
      el.setAttribute("aria-label", `${spot.rank}. ${spot.name}`);
      el.innerHTML = [
        `<div style="`,
        `  width:${isPrimary ? 36 : 28}px;`,
        `  height:${isPrimary ? 36 : 28}px;`,
        `  border-radius:50%;`,
        `  background:${fill};`,
        `  border:2px solid ${palette.markerBorder};`,
        `  display:flex;`,
        `  align-items:center;`,
        `  justify-content:center;`,
        `  font-weight:700;`,
        `  font-size:${isPrimary ? 14 : 11}px;`,
        `  color:${palette.markerText};`,
        `  box-shadow:0 2px 6px rgba(0,0,0,0.5);`,
        `  cursor:pointer;`,
        `">${spot.rank}</div>`,
      ].join("");

      el.onclick = () => onSpotSelect?.(spot);

      const marker = new Marker({ element: el })
        .setLngLat([spot.lon, spot.lat])
        .setPopup(
          new Popup({ offset: 25 }).setHTML(
            [
              `<strong>${spot.name}</strong>`,
              `<br/>`,
              `<small>≈ ${spot.driveTimeMin} min drive · ${spot.accessConfidence}</small>`,
              `<br/>`,
              `<a href="${spot.deepLinks.googleMaps}" target="_blank" rel="noopener">`,
              `Directions (Google Maps)`,
              `</a>`,
            ].join(""),
          ),
        )
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [spots, onSpotSelect, palette]);

  // Draw isochrone polygon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isochrone) return;

    const sourceId = "isochrone-source";
    const layerId = "isochrone-layer";

    // Remove previous isochrone layers if they exist.
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(`${layerId}-outline`)) map.removeLayer(`${layerId}-outline`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {
      // Layer/source may not exist yet.
    }

    // Only draw polygon features; skip points.
    const polygonFeatures = isochrone.features.filter(
      (f) => f.geometry.type === "Polygon",
    );
    if (polygonFeatures.length === 0) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: polygonFeatures },
    });

    map.addLayer({
      id: layerId,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": palette.isochroneFill,
        "fill-opacity": 0.15,
      },
    });

    map.addLayer({
      id: `${layerId}-outline`,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": palette.isochroneFill,
        "line-opacity": 0.6,
        "line-width": 2,
      },
    });
  }, [isochrone, palette]);

  return (
    <div
      ref={containerRef}
      className={`map-container ${className ?? ""}`}
      aria-label="Sky map with light pollution overlay"
      role="application"
    >
      {/* Red-light overlay: a multiply blend grades the WebGL canvas toward
          monochrome red without a CSS `filter` (which would kill the GL context).
          See globals.css `[data-theme="red"] .map-red-overlay`. */}
      {isRed && <div className="map-red-overlay" aria-hidden="true" />}
    </div>
  );
};

export default MapView;