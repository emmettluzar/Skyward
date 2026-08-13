"use client";

import { useEffect, useRef, type FC } from "react";
import { Map, NavigationControl, GeolocateControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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

export interface MapViewProps {
  /** Called when the user's location is first obtained (or fallback). */
  onLocationReady?: (lat: number, lng: number) => void;
  /** Optional className for the container div. */
  className?: string;
}

const MapView: FC<MapViewProps> = ({ onLocationReady, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const locationCalledRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: OPENFREE_MAP_STYLE,
      center: DEFAULT_CENTER,
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
    // v5: the "geolocate" event passes a GeolocationPosition as the event data
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

  useEffect(() => {
    // Handle resize when parent layout changes
    const map = mapRef.current;
    if (!map) return;
    const handler = () => map.resize();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`map-container ${className ?? ""}`}
      aria-label="Sky map with light pollution overlay"
      role="application"
    />
  );
};

export default MapView;