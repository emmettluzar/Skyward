"use client";

import { Sparkles, Loader2, CloudOff } from "lucide-react";
import type {
  ApiVerdict,
  VerdictResponse,
} from "@/lib/types/verdict";

const VERDICT_STYLES: Record<ApiVerdict, string> = {
  GO: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  MAYBE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "STAY HOME": "bg-rose-500/15 text-rose-300 border-rose-500/30",
  UNKNOWN: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export function VerdictCard({
  verdict,
  isLoading,
  isError,
  data,
}: {
  verdict?: VerdictResponse;
  isLoading: boolean;
  isError: boolean;
  data?: VerdictResponse;
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">
              Finding the best sky…
            </p>
            <p className="text-sm text-muted-foreground">
              Analyzing darkness, clouds & moon for tonight
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
            <CloudOff className="size-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">
              Couldn't reach the sky
            </p>
            <p className="text-sm text-muted-foreground">
              Check your connection and try again
            </p>
          </div>
        </div>
      </div>
    );
  }

  const v = verdict ?? data;
  if (!v) return null;

  return (
    <div
      className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl sm:p-5"
      aria-live="polite"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">
              <span
                className={`inline-block rounded-full border px-3 py-0.5 text-sm font-semibold ${
                  VERDICT_STYLES[v.verdict]
                }`}
              >
                {v.verdict}
              </span>
            </p>
            {v.wTonight !== null && (
              <p className="mt-1 text-sm text-muted-foreground">
                Worth it: <strong>{v.wTonight.toFixed(1)}</strong>
                {v.deltaQ !== null && (
                  <>
                    {" "}
                    · ΔQ {v.deltaQ >= 0 ? "+" : ""}
                    {v.deltaQ.toFixed(1)}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Reason chips — must always justify the verdict (.clinerules §3). */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {v.reasons.map((reason) => (
          <span
            key={reason}
            className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
          >
            {reason}
          </span>
        ))}
      </div>

      {/* Honest provenance / partial flags (.clinerules §0.4, §4). */}
      {v.partial.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Partial data: {v.partial.join(", ")}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground/60">
        Sky conditions by Open-Meteo · Moon by astronomy-engine (offline)
      </p>
    </div>
  );
}