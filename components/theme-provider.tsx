"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

/**
 * Theme state: "dark" (default), "light", or "red" (field red-light mode).
 *
 * The red-light theme is a CSS-variable theme applied as `[data-theme="red"]` on
 * the <html> element, NOT a filter hack (.clinerules §5). The theme is purely
 * presentational UI state, so it lives in React context; server data stays in
 * TanStack Query and any future UI-only state would use Zustand.
 */

export type Theme = "dark" | "light" | "red";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Cycle dark → red → dark; used by the field-toggle button. */
  toggleRed: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "skyward.theme";

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "red") {
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode). Fall through to default.
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initializer reads the persisted preference once, client-side only.
  // `typeof window` guard keeps the SSR pass deterministic (server renders "dark")
  // and avoids calling setState inside an effect (react-hooks/set-state-in-effect).
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "dark" : readStoredTheme(),
  );

  // Apply the theme attribute to <html> whenever it changes. This effect only
  // touches an external system (the DOM); it never sets React state.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme === "red" ? "red" : "none");
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Non-fatal: preference just won't persist.
    }
  }, []);

  const toggleRed = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "red" ? "dark" : "red";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // The red overrides live in globals.css under `[data-theme="red"]`, not in a
  // CSS `filter` hack (which would break the MapLibre WebGL canvas and is banned
  // by .clinerules §5).

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleRed }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}