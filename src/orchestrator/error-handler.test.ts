import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyError,
  calculateBackoffDelay,
  retryWithBackoff,
} from './error-handler.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';
import type { RetryConfig } from './types.js';

// ── classifyError ───────────────────────────────────────────────────

describe('classifyError', () => {
  it('classifies context overflow errors as non-retryable', () => {
    const result = classifyError('context overflow exceeded');
    expect(result.type).toBe('context_overflow');
    expect(result.retryable).toBe(false);
    expect(result.maxRetries).toBe(0);
    expect(result.message).toBe('context overflow exceeded');
  });

  it('classifies token limit errors as context_overflow', () => {
    const result = classifyError('context token limit reached');
    expect(result.type).toBe('context_overflow');
    expect(result.retryable).toBe(false);
  });

  it('classifies transient network errors as retryable', () => {
    const result = classifyError('ECONNRESET on socket');
    expect(result.type).toBe('transient');
    expect(result.retryable).toBe(true);
    expect(result.maxRetries).toBe(3);
  });

  it('classifies rate limit errors as transient', () => {
    const result = classifyError('rate limit exceeded, retry after 30s');
    expect(result.type).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies 429 status as transient', () => {
    const result = classifyError('HTTP 429 Too Many Requests');
    expect(result.type).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies ETIMEDOUT as transient', () => {
    const result = classifyError('ETIMEDOUT connecting to API');
    expect(result.type).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies test failures as retryable with 2 retries', () => {
    const result = classifyError('test assertion failed');
    expect(result.type).toBe('test_failure');
    expect(result.retryable).toBe(true);
    expect(result.maxRetries).toBe(2);
  });

  it('classifies expect errors as test_failure', () => {
    const result = classifyError('expect(received).toBe(expected) error');
    expect(result.type).toBe('test_failure');
    expect(result.retryable).toBe(true);
  });

  it('classifies merge conflicts as retryable with 1 retry', () => {
    const result = classifyError('CONFLICT in merge of branch');
    expect(result.type).toBe('merge_conflict');
    expect(result.retryable).toBe(true);
    expect(result.maxRetries).toBe(1);
  });

  it('classifies conflict markers as merge_conflict', () => {
    const result = classifyError('Found <<<<<<< in file.ts');
    expect(result.type).toBe('merge_conflict');
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown errors as fatal and non-retryable', () => {
    const result = classifyError('unknown catastrophic error');
    expect(result.type).toBe('fatal');
    expect(result.retryable).toBe(false);
    expect(result.maxRetries).toBe(0);
  });

  it('preserves original message in classified error', () => {
    const msg = 'some specific error message';
    const result = classifyError(msg);
    expect(result.message).toBe(msg);
  });
});

// ── calculateBackoffDelay ───────────────────────────────────────────

describe('calculateBackoffDelay', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
  };

  it('returns delay in [0, baseDelayMs) for attempt 0', () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(0, config);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(config.baseDelayMs);
    }
  });

  it('returns delay in [0, baseDelayMs*2) for attempt 1', () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(1, config);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(config.baseDelayMs * 2);
    }
  });

  it('returns delay in [0, baseDelayMs*4) for attempt 2', () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(2, config);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(config.baseDelayMs * 4);
    }
  });

  it('caps delay at maxDelayMs for high attempt numbers', () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(10, config);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(config.maxDelayMs);
    }
  });

  it('returns integer values', () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateBackoffDelay(i % 5, config);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});

// ── retryWithBackoff ────────────────────────────────────────────────

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = retryWithBackoff(fn);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('recovered');

    const promise = retryWithBackoff(fn);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws last error after exhausting retries', async () => {
    const config: RetryConfig = {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    };
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

    const promise = retryWithBackoff(fn, config);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('persistent failure');
    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls fn exactly maxRetries+1 times on repeated failure', async () => {
    const config: RetryConfig = {
      maxRetries: 4,
      baseDelayMs: 50,
      maxDelayMs: 500,
    };
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    const promise = retryWithBackoff(fn, config);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('uses default retry config when none provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = retryWithBackoff(fn);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('fail');
    // default maxRetries=3, so 4 calls total
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
