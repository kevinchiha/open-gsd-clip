import { setTimeout } from 'node:timers/promises';
import type { ClassifiedError, RetryConfig } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';
import type { ErrorType } from '../pipeline/types.js';

// ── Error Pattern Definitions ───────────────────────────────────────

interface ErrorPattern {
  pattern: RegExp;
  type: ErrorType;
  retryable: boolean;
  maxRetries: number;
}

/**
 * Ordered list of error patterns. First match wins.
 * Order matters: more specific patterns before general ones.
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /context.*(overflow|limit|too long|token)/i,
    type: 'context_overflow',
    retryable: false,
    maxRetries: 0,
  },
  {
    pattern: /(test|assertion|expect).*(fail|error)/i,
    type: 'test_failure',
    retryable: true,
    maxRetries: 2,
  },
  {
    pattern: /(merge conflict|CONFLICT|<<<<<<)/i,
    type: 'merge_conflict',
    retryable: true,
    maxRetries: 1,
  },
  {
    pattern: /(ECONNRESET|ETIMEDOUT|rate.?limit|503|502|429)/i,
    type: 'transient',
    retryable: true,
    maxRetries: 3,
  },
];

// ── Error Classification ────────────────────────────────────────────

/**
 * Classify an error message into one of five categories.
 * Iterates ERROR_PATTERNS in order; first match wins.
 * Unmatched messages default to 'fatal' (not retryable).
 */
export function classifyError(message: string): ClassifiedError {
  for (const entry of ERROR_PATTERNS) {
    if (entry.pattern.test(message)) {
      return {
        type: entry.type,
        retryable: entry.retryable,
        maxRetries: entry.maxRetries,
        message,
      };
    }
  }

  return {
    type: 'fatal',
    retryable: false,
    maxRetries: 0,
    message,
  };
}

// ── Backoff Delay Calculation ───────────────────────────────────────

/**
 * Calculate exponential backoff delay with full jitter.
 *
 * Formula: floor(random() * min(baseDelay * 2^attempt, maxDelay))
 *
 * Full jitter spreads requests uniformly across the delay window,
 * reducing thundering herd effects compared to equal or decorrelated jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  return Math.floor(Math.random() * cappedDelay);
}

// ── Retry With Backoff ──────────────────────────────────────────────

/**
 * Retry an async operation with exponential backoff and full jitter.
 *
 * Calls fn up to (maxRetries + 1) times total.
 * On failure, waits calculateBackoffDelay(attempt) ms before retrying.
 * Throws the last error after all retries are exhausted.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt, config);
        await setTimeout(delay);
      }
    }
  }

  throw lastError;
}
