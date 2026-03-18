import { GsdOperationalError } from '../shared/errors.js';

/**
 * Base error for all GSD bridge operations.
 * Carries the command name that failed.
 */
export class GsdBridgeError extends GsdOperationalError {
  public readonly command: string;

  constructor(command: string, message?: string, options?: ErrorOptions) {
    super(message ?? `GSD bridge command '${command}' failed`, options);
    this.command = command;
  }
}

/**
 * Thrown when gsd-tools.cjs cannot be found at any search location.
 */
export class GsdToolsNotFoundError extends GsdBridgeError {
  public readonly searchedPaths: string[];

  constructor(searchedPaths: string[]) {
    super(
      'tool-discovery',
      `gsd-tools.cjs not found. Searched:\n${searchedPaths.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.searchedPaths = searchedPaths;
  }
}

/**
 * Thrown when gsd-tools.cjs output cannot be parsed as JSON,
 * or when Zod schema validation fails.
 */
export class GsdParseError extends GsdBridgeError {
  public readonly rawOutput: string;

  constructor(command: string, rawOutput: string, message?: string) {
    super(command, message ?? `Failed to parse output of '${command}'`);
    this.rawOutput = rawOutput;
  }
}

/**
 * Thrown when a gsd-tools.cjs command exceeds the timeout.
 */
export class GsdTimeoutError extends GsdBridgeError {
  public readonly timeoutMs: number;

  constructor(command: string, timeoutMs: number) {
    super(command, `Command '${command}' timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}
