/**
 * Tests for the token usage tracker.
 *
 * Verifies that TokenTracker accumulates token usage per phase/role,
 * returns per-phase breakdowns via getSummary, and pipeline-wide
 * totals via getTotal.
 */

import { describe, expect, it } from 'vitest';
import { TokenTracker } from './token-tracker.js';

describe('TokenTracker', () => {
  it('records and retrieves usage for a single phase/role', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'executor', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
    const summary = tracker.getSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].phaseNumber).toBe(1);
    expect(summary[0].byRole.executor).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
    expect(summary[0].total).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
  });

  it('accumulates tokens for same phase/role', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'executor', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
    tracker.recordUsage(1, 'executor', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      costCents: 0.6,
    });
    const summary = tracker.getSummary();
    expect(summary[0].byRole.executor).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
      costCents: 0.9,
    });
  });

  it('handles multiple roles per phase', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'planner', {
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75,
      costCents: 0.15,
    });
    tracker.recordUsage(1, 'executor', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      costCents: 0.6,
    });
    const summary = tracker.getSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].total).toEqual({
      inputTokens: 250,
      outputTokens: 125,
      totalTokens: 375,
      costCents: 0.75,
    });
  });

  it('handles multiple phases', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'executor', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
    tracker.recordUsage(2, 'executor', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      costCents: 0.6,
    });
    const summary = tracker.getSummary();
    expect(summary).toHaveLength(2);
    expect(summary[0].phaseNumber).toBe(1);
    expect(summary[1].phaseNumber).toBe(2);
  });

  it('getTotal returns pipeline-wide aggregate', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'planner', {
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75,
      costCents: 0.15,
    });
    tracker.recordUsage(1, 'executor', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costCents: 0.3,
    });
    tracker.recordUsage(2, 'verifier', {
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      costCents: 0.24,
    });
    const total = tracker.getTotal();
    expect(total).toEqual({
      inputTokens: 230,
      outputTokens: 115,
      totalTokens: 345,
      costCents: 0.69,
    });
  });

  it('handles partial usage (only some fields provided)', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(1, 'executor', { inputTokens: 100 });
    const summary = tracker.getSummary();
    expect(summary[0].byRole.executor).toEqual({
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
    });
  });

  it('returns empty summary when no usage recorded', () => {
    const tracker = new TokenTracker();
    expect(tracker.getSummary()).toEqual([]);
    expect(tracker.getTotal()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
    });
  });
});
