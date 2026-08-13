/**
 * Typed application error (.clinerules §5).
 *
 * Every error surfaced to a user must have a stable `code`, a `userMessage`
 * that never leaks raw upstream error strings, and an optional `cause` kept
 * for server-side structured logging only.
 */

export interface AppErrorInit {
  /** Stable machine-readable code, e.g. "UPSTREAM_HTTP_502". */
  code: string;
  /** Human-readable, safe-to-render message. */
  userMessage: string;
  /** Original cause, logged server-side. Never sent to the client. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly cause?: unknown;

  constructor(init: AppErrorInit) {
    super(init.userMessage);
    this.name = "AppError";
    this.code = init.code;
    this.userMessage = init.userMessage;
    this.cause = init.cause;
  }
}