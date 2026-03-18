/**
 * Discriminated union for operation results.
 * Prefer this over throwing for expected failure paths
 * where the caller needs to handle both outcomes.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Represents any valid JSON value.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

/**
 * Represents a JSON object with string keys and JSON values.
 */
export type JsonObject = { [key: string]: JsonValue };
