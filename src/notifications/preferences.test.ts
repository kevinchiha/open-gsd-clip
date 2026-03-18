/**
 * Tests for notification preference filtering.
 *
 * Verifies that shouldNotify correctly allows/blocks events
 * based on each of the four preference modes.
 */

import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_PREFERENCES,
  type NotificationPreference,
  shouldNotify,
} from './preferences.js';

describe('NOTIFICATION_PREFERENCES', () => {
  it('contains all four preference values', () => {
    expect(NOTIFICATION_PREFERENCES).toEqual([
      'all',
      'failures_only',
      'completions_only',
      'escalations_only',
    ]);
  });
});

describe('shouldNotify', () => {
  describe('all preference', () => {
    it('allows any event', () => {
      expect(shouldNotify('all', 'pipeline_started')).toBe(true);
      expect(shouldNotify('all', 'phase_completed')).toBe(true);
      expect(shouldNotify('all', 'phase_failed')).toBe(true);
      expect(shouldNotify('all', 'escalation')).toBe(true);
      expect(shouldNotify('all', 'pipeline_completed')).toBe(true);
    });
  });

  describe('failures_only preference', () => {
    it('allows phase_failed', () => {
      expect(shouldNotify('failures_only', 'phase_failed')).toBe(true);
    });

    it('allows pipeline_failed', () => {
      expect(shouldNotify('failures_only', 'pipeline_failed')).toBe(true);
    });

    it('blocks phase_completed', () => {
      expect(shouldNotify('failures_only', 'phase_completed')).toBe(false);
    });

    it('blocks pipeline_started', () => {
      expect(shouldNotify('failures_only', 'pipeline_started')).toBe(false);
    });
  });

  describe('completions_only preference', () => {
    it('allows pipeline_completed', () => {
      expect(shouldNotify('completions_only', 'pipeline_completed')).toBe(
        true,
      );
    });

    it('allows phase_completed', () => {
      expect(shouldNotify('completions_only', 'phase_completed')).toBe(true);
    });

    it('blocks phase_failed', () => {
      expect(shouldNotify('completions_only', 'phase_failed')).toBe(false);
    });

    it('blocks pipeline_started', () => {
      expect(shouldNotify('completions_only', 'pipeline_started')).toBe(false);
    });
  });

  describe('escalations_only preference', () => {
    it('allows escalation', () => {
      expect(shouldNotify('escalations_only', 'escalation')).toBe(true);
    });

    it('blocks phase_completed', () => {
      expect(shouldNotify('escalations_only', 'phase_completed')).toBe(false);
    });

    it('blocks pipeline_started', () => {
      expect(shouldNotify('escalations_only', 'pipeline_started')).toBe(false);
    });
  });
});
