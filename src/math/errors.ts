/**
 * A single error type for the whole math layer so the UI can show a message
 * and (when we know it) highlight the offending slice of source.
 */
export class MathError extends Error {
  readonly start: number;
  readonly end: number;

  constructor(message: string, start = -1, end = -1) {
    super(message);
    this.name = "MathError";
    this.start = start;
    this.end = end;
  }
}

export function fail(message: string, token?: { start: number; end: number }): never {
  throw new MathError(message, token?.start ?? -1, token?.end ?? -1);
}