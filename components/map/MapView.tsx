"use client";

import { useEffect, useRef, useState, useCallback, type FC } from "react";
import {
  Map,
  NavigationControl,
  GeolocateControl,
  Marker,
  Popup,
  type LngLatLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers, Sparkles } from "lucide-react";
import type { CandidateSpot, GeoJsonFeatureCollection } from "@/lib/types/places";
import { bortleFromSqm } from "@/lib/darkness/bortle";
import { generateHighResHeatmapPoints } from "@/lib/darkness/model";

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

const COLORS = {
  markerPrimary: "#3b82f6",
  markerSecondary: "#6366f1",
  markerBorder: "#ffffff",
  markerText: "#ffffff",
  isochroneFill: "#3b82f6",
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
  /** User origin location to center/snap to */
  userOrigin?: [number, number];
  /** Called when a marker is clicked, with the spot for the detail pane. */
  onSpotSelect?: (spot: CandidateSpot) => void;
}

const MapView: FC<MapViewProps> = ({
  onLocationReady,
  className,
  spots,
  isochrone,
  center,
  userOrigin,
  onSpotSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const geolocateControlRef = useRef<GeolocateControl | null>(null);
  const locationCalledRef = useRef(false);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(true);

  // Toggle light pollution heatmap layer
  const toggleHeatmap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextState = !showHeatmap;
    setShowHeatmap(nextState);

    const layerId = "light-pollution-heatmap";
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", nextState ? "visible" : "none");
    }
  }, [showHeatmap]);


  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: OPENFREE_MAP_STYLE,
      center: center ?? userOrigin ?? DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    // Add navigation controls (zoom +/- and compass)
    map.addControl(new NavigationControl({ showCompass: true, showZoom: true }), "top-right");

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
    geolocateControlRef.current = geolocate;
    map.addControl(geolocate, "bottom-right");

    // When user location is obtained, center map and notify parent
    const onGeolocate = (e: unknown) => {
      const pos = e as GeolocationPosition;
      const { latitude, longitude } = pos.coords;
      map.flyTo({ center: [longitude, latitude], zoom: 10 });
      locationCalledRef.current = true;
      onLocationReady?.(latitude, longitude);
    };

    // Fallback: if geolocation fails, notify with default location
    const onGeolocateError = () => {
      if (!locationCalledRef.current) {
        locationCalledRef.current = true;
        onLocationReady?.(DEFAULT_CENTER[1], DEFAULT_CENTER[0]);
      }
    };

    geolocate.on("geolocate", onGeolocate);
    geolocate.on("error", onGeolocateError);

    // Handle missing sprite images
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

    // When style loads, add Light Pollution Heatmap source & layers
    map.on("style.load", () => {
      geolocate.trigger();

      // Add granular high-resolution light pollution heatmap overlay
      const initialCenter = center ?? userOrigin ?? DEFAULT_CENTER;
      const initialPoints = generateHighResHeatmapPoints(initialCenter[1], initialCenter[0], 250, 4);

      if (!map.getSource("lp-heat-source")) {
        map.addSource("lp-heat-source", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: initialPoints.map((p) => ({
              type: "Feature",
              properties: { intensity: p.intensity },
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            })),
          },
        });

        map.addLayer({
          id: "light-pollution-heatmap",
          type: "heatmap",
          source: "lp-heat-source",
          paint: {
            "heatmap-weight": ["get", "intensity"],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3, 1.0,
              7, 2.0,
              11, 3.5,
              14, 5.0,
            ],
            // Color ramp from pristine dark sky through rural, suburban to intense urban core
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(8, 12, 28, 0)",
              0.12, "rgba(24, 48, 100, 0.25)",
              0.28, "rgba(16, 110, 80, 0.40)",
              0.48, "rgba(180, 150, 15, 0.55)",
              0.72, "rgba(220, 60, 40, 0.70)",
              0.92, "rgba(255, 240, 240, 0.88)",
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3, 15,
              7, 28,
              10, 45,
              13, 75,
            ],
            "heatmap-opacity": 0.65,
          },
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle resize
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => map.resize();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Recenter and dynamically update high-resolution light pollution grid around user origin / center
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = center ?? userOrigin;
    if (target) {
      if (center) {
        map.flyTo({ center: center as LngLatLike, zoom: 10 });
      }
      const source = map.getSource("lp-heat-source");
      if (source && "setData" in source) {
        const points = generateHighResHeatmapPoints(target[1], target[0], 250, 4);
        (source as { setData: (data: unknown) => void }).setData({
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            properties: { intensity: p.intensity },
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
          })),
        });
      }
    }
  }, [center, userOrigin]);

  // Place candidate markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    if (!spots || spots.length === 0) return;

    for (const spot of spots) {
      const isPrimary = spot.rank === 1;
      const fill = isPrimary ? COLORS.markerPrimary : COLORS.markerSecondary;

      const el = document.createElement("div");
      el.className = "candidate-marker";
      el.setAttribute("aria-label", `${spot.rank}. ${spot.name}`);
      el.innerHTML = [
        `<div style="`,
        `  width:${isPrimary ? 36 : 28}px;`,
        `  height:${isPrimary ? 36 : 28}px;`,
        `  border-radius:50%;`,
        `  background:${fill};`,
        `  border:2px solid ${COLORS.markerBorder};`,
        `  display:flex;`,
        `  align-items:center;`,
        `  justify-content:center;`,
        `  font-weight:700;`,
        `  font-size:${isPrimary ? 14 : 11}px;`,
        `  color:${COLORS.markerText};`,
        `  box-shadow:0 2px 6px rgba(0,0,0,0.6);`,
        `  cursor:pointer;`,
        `">${spot.rank}</div>`,
      ].join("");

      el.onclick = () => onSpotSelect?.(spot);

      const bortle = spot.sqmMpsas !== null ? bortleFromSqm(spot.sqmMpsas) : null;
      const darknessInfo = spot.sqmMpsas !== null
        ? `≈ Bortle ${bortle} · ${spot.sqmMpsas.toFixed(2)} mag/arcsec²`
        : "Darkness evaluating";

      const marker = new Marker({ element: el })
        .setLngLat([spot.lon, spot.lat])
        .setPopup(
          new Popup({ offset: 25 }).setHTML(
            [
              `<strong>#${spot.rank} ${spot.name}</strong>`,
              `<br/>`,
              `<small>${darknessInfo}</small>`,
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
  }, [spots, onSpotSelect]);

  // Draw isochrone polygon
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isochrone) return;

    const sourceId = "isochrone-source";
    const layerId = "isochrone-layer";

    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(`${layerId}-outline`)) map.removeLayer(`${layerId}-outline`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {
      // Layer/source may not exist yet.
    }

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
        "fill-color": COLORS.isochroneFill,
        "fill-opacity": 0.15,
      },
    });

    map.addLayer({
      id: `${layerId}-outline`,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": COLORS.isochroneFill,
        "line-opacity": 0.6,
        "line-width": 2,
      },
    });
  }, [isochrone]);

  return (
    <div
      ref={containerRef}
      className={`map-container relative ${className ?? ""}`}
      aria-label="Interactive dark sky map with light pollution overlay"
      role="application"
    >
      {/* ── Custom Map Control Bar (Top Left) ── */}
      <div className="absolute top-16 left-3 sm:left-6 z-10 flex flex-col gap-2">
        {/* Toggle Heatmap Overlay Button */}
        <button
          type="button"
          onClick={toggleHeatmap}
          className={`flex items-center gap-1.5 rounded-xl border border-border/50 px-2.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all ${
            showHeatmap
              ? "bg-primary text-primary-foreground shadow-primary/20"
              : "bg-card/90 text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
          title="Toggle Light Pollution Heatmap Overlay"
          aria-pressed={showHeatmap}
        >
          <Layers className="size-3.5" />
          <span>{showHeatmap ? "Heatmap On" : "Heatmap Off"}</span>
        </button>
      </div>

      {/* ── Map Legend (Light Pollution Heatmap) ── */}
      {showHeatmap && (
        <div className="absolute top-16 right-14 z-10 hidden sm:flex flex-col gap-1 rounded-xl border border-border/50 bg-card/85 p-2 text-[10px] text-muted-foreground shadow-md backdrop-blur-md">
          <span className="font-semibold text-foreground">Light Pollution</span>
          <div className="flex h-2.5 w-28 rounded-full overflow-hidden bg-linear-to-r from-blue-900 via-emerald-500 via-yellow-400 to-red-500" />
          <div className="flex justify-between font-mono">
            <span>Dark (Bortle 1)</span>
            <span>City (B8-9)</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;