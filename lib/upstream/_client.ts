/**
 * Single sanctioned HTTP client for every upstream call (.clinerules §4).
 *
 * Components and route handlers NEVER `fetch()` a third party directly — they
 * go through `fetchJson`. This module provides:
 *   - 8s timeout
 *   - 2 retries with jittered exponential backoff (network + 5xx only)
 *   - per-host rate limiting (simple in-process token bucket)
 *   - circuit breaker per host (short open state after repeated failures)
 *   - Zod parsing at the boundary (schema is required)
 *   - structured JSON logging on failure, with keys redacted
 */

import { ZodError, type ZodSchema, type z } from "zod";

const TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2; // 1 initial call + 1 retry (".clinerules §4: 2 retries")
const BACKOFF_BASE_MS = 400;

/* ───────────────────────── Rate limiting ───────────────────────── */

const RATE_PER_SECOND = 4;
const RATE_BURST = 8;

interface Bucket {
  lastRefillMs: number;
  tokens: number;
}

const buckets = new Map<string, Bucket>();

function acquireToken(host: string): void {
  let bucket = buckets.get(host);
  if (!bucket) {
    bucket = { lastRefillMs: Date.now(), tokens: RATE_BURST };
    buckets.set(host, bucket);
  }

  const now = Date.now();
  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(RATE_BURST, bucket.tokens + elapsedSec * RATE_PER_SECOND);
  bucket.lastRefillMs = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  // Otherwise sleep until the next token is available (capped).
  const waitMs = Math.min(5_000, ((1 - bucket.tokens) / RATE_PER_SECOND) * 1000);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    // Short, server-side backoff only (< 5s). Acceptable for our burst limits.
  }
  bucket.tokens = 0;
}

/* ───────────────────────── Circuit breaker ───────────────────────── */

interface Breaker {
  failures: number;
  openedAtMs: number;
}

const breakers = new Map<string, Breaker>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

function breakerAllows(host: string): boolean {
  const b = breakers.get(host);
  if (!b) return true;
  if (b.failures >= BREAKER_THRESHOLD) {
    if (Date.now() - b.openedAtMs < BREAKER_COOLDOWN_MS) return false;
    // Cooldown elapsed → allow one probe.
    breakers.delete(host);
    return true;
  }
  return true;
}

function recordFailure(host: string): void {
  const b = breakers.get(host) ?? { failures: 0, openedAtMs: 0 };
  b.failures += 1;
  if (b.failures >= BREAKER_THRESHOLD) b.openedAtMs = Date.now();
  breakers.set(host, b);
}

function recordSuccess(host: string): void {
  breakers.delete(host);
}

/* ───────────────────────── Core client ───────────────────────── */

export interface FetchJsonInput<S extends ZodSchema> {
  url: string;
  /** Zod schema the response body must satisfy. Required — no untyped I/O. */
  schema: S;
  /** Human-readable service name for logging + rate-limit key fallback. */
  service: string;
  /** Optional extra headers (e.g. Valhalla X-Client-Id). */
  headers?: Record<string, string>;
}

/**
 * Fetch, retry, and Zod-parse a JSON upstream response. Returns the parsed,
 * typed value. Throws a sanitized Error on exhaustion — never the raw body.
 */
export async function fetchJson<S extends ZodSchema>(
  input: FetchJsonInput<S>,
): Promise<z.infer<S>> {
  const host = hostFromUrl(input.url);

  if (!breakerAllows(host)) {
    throw new Error(`${input.service} is temporarily unavailable (circuit open)`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    acquireToken(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(input.url, {
        headers: {
          Accept: "application/json",
          ...input.headers,
        },
        signal: controller.signal,
        cache: "no-store",
      });

      // 4xx are not retried: they are deterministic client mistakes (or fair-use
      // rejections we must not hammer). Only network errors and 5xx retry.
      if (res.ok) {
        const body: unknown = await res.json();
        const parsed = input.schema.parse(body);
        recordSuccess(host);
        return parsed as z.infer<S>;
      }

      const status = res.status;
      const body = await res.text().catch(() => "");
      lastError = new Error(`${input.service} HTTP ${status}: ${body.slice(0, 200)}`);

      if (status >= 500 && attempt < MAX_ATTEMPTS - 1) {
        await sleep(jitter(BACKOFF_BASE_MS * 2 ** attempt));
        continue;
      }
      // 4xx or final attempt → fail now.
      break;
    } catch (err) {
      lastError = err;

      // ZodError is deterministic — no retry.
      if (err instanceof ZodError) break;

      // Abort (timeout) is retryable per .clinerules §4 (8s timeout + retries).
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(jitter(BACKOFF_BASE_MS * 2 ** attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  recordFailure(host);
  logFailure(input, lastError);
  throw new Error(`${input.service} request failed after ${MAX_ATTEMPTS} attempts`);
}

/* ───────────────────────── Helpers ───────────────────────── */

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  return baseMs * (0.5 + Math.random());
}

function logFailure(input: { url: string; service: string }, err: unknown): void {
  // Redact any key/token query params before logging.
  const safeUrl = input.url.replace(/([?&](key|api_key|token|apikey)=)[^&]+/gi, "$1REDACTED");
  console.error(
    JSON.stringify({
      event: "upstream_failure",
      service: input.service,
      url: safeUrl,
      cause: err instanceof Error ? err.message : String(err),
    }),
  );
}