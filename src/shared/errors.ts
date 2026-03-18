/**
 * Base error class for the @open-gsd/clip project.
 * Automatically sets `name` from the constructor name.
 */
export class GsdError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * Operational error for expected failure modes:
 * bridge errors, parse errors, timeouts, signal validation failures.
 *
 * These are "expected" in the sense that they represent conditions
 * the system should handle gracefully (retry, report, skip).
 */
export class GsdOperationalError extends GsdError {}
