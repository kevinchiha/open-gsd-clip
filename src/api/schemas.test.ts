/**
 * Tests for API action request Zod schemas.
 *
 * Verifies that StartSchema, RetrySchema, OverrideSchema, and
 * PreferenceSchema accept valid inputs and reject invalid ones
 * with appropriate error messages.
 */

import { describe, expect, it } from 'vitest';
import {
  OverrideSchema,
  PreferenceSchema,
  RetrySchema,
  StartSchema,
} from './schemas.js';

describe('StartSchema', () => {
  it('accepts valid input', () => {
    const result = StartSchema.safeParse({
      projectPath: '/home/user/project',
      brief: 'Build a todo app',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty projectPath', () => {
    const result = StartSchema.safeParse({
      projectPath: '',
      brief: 'Build a todo app',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty brief', () => {
    const result = StartSchema.safeParse({
      projectPath: '/home/user/project',
      brief: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = StartSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('RetrySchema', () => {
  it('accepts valid phaseNumber', () => {
    const result = RetrySchema.safeParse({ phaseNumber: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts optional fromStep', () => {
    const result = RetrySchema.safeParse({
      phaseNumber: 3,
      fromStep: 'discussing',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromStep).toBe('discussing');
    }
  });

  it('rejects non-positive integers', () => {
    expect(RetrySchema.safeParse({ phaseNumber: 0 }).success).toBe(false);
    expect(RetrySchema.safeParse({ phaseNumber: -1 }).success).toBe(false);
  });

  it('rejects non-integer numbers', () => {
    expect(RetrySchema.safeParse({ phaseNumber: 1.5 }).success).toBe(false);
  });
});

describe('OverrideSchema', () => {
  it('accepts valid ESC-prefixed escalation ID', () => {
    const result = OverrideSchema.safeParse({
      escalationId: 'ESC-550e8400-e29b-41d4-a716-446655440000',
      decision: 'proceed with option A',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-ESC-prefixed ID', () => {
    const result = OverrideSchema.safeParse({
      escalationId: 'not-an-esc-id',
      decision: 'proceed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decision', () => {
    const result = OverrideSchema.safeParse({
      escalationId: 'ESC-550e8400-e29b-41d4-a716-446655440000',
      decision: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('PreferenceSchema', () => {
  it.each(['all', 'failures_only', 'completions_only', 'escalations_only'])(
    'accepts "%s"',
    (pref) => {
      const result = PreferenceSchema.safeParse({ preference: pref });
      expect(result.success).toBe(true);
    },
  );

  it('rejects invalid preference string', () => {
    const result = PreferenceSchema.safeParse({ preference: 'none' });
    expect(result.success).toBe(false);
  });
});
