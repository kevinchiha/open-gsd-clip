/**
 * Tests for pipeline event notification formatters.
 *
 * Verifies that formatPipelineEvent produces human-readable strings
 * for all 9 pipeline event types without emojis.
 */

import { describe, expect, it } from 'vitest';
import type { PipelineNotificationEvent } from './formatters.js';
import { formatPipelineEvent } from './formatters.js';

describe('formatPipelineEvent', () => {
  it('formats pipeline_started with project path', () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_started',
      projectPath: '/home/user/myproject',
      brief: 'Build a todo app',
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('/home/user/myproject');
    expect(msg).toContain('Build a todo app');
  });

  it('formats phase_started with phase number', () => {
    const event: PipelineNotificationEvent = {
      type: 'phase_started',
      phaseNumber: 3,
      phaseName: 'Agent Spawning',
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('3');
    expect(msg).toContain('Agent Spawning');
  });

  it('formats phase_completed with phase number', () => {
    const event: PipelineNotificationEvent = {
      type: 'phase_completed',
      phaseNumber: 2,
      phaseName: 'State Machines',
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('2');
  });

  it('formats phase_failed with error message', () => {
    const event: PipelineNotificationEvent = {
      type: 'phase_failed',
      phaseNumber: 1,
      phaseName: 'Foundation',
      error: 'Test failures in core module',
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('Test failures in core module');
  });

  it('formats escalation with context and numbered options', () => {
    const event: PipelineNotificationEvent = {
      type: 'escalation',
      phaseNumber: 4,
      context: 'Quality gate failed after 3 revisions',
      options: ['Retry with new prompt', 'Skip phase', 'Abort pipeline'],
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('Quality gate failed after 3 revisions');
    expect(msg).toContain('1.');
    expect(msg).toContain('Retry with new prompt');
    expect(msg).toContain('2.');
    expect(msg).toContain('Skip phase');
    expect(msg).toContain('3.');
    expect(msg).toContain('Abort pipeline');
    // Multi-line: context and options separated by blank line
    expect(msg).toContain('\n\n');
  });

  it('formats pipeline_completed with total phase count', () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_completed',
      totalPhases: 6,
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('6');
  });

  it('formats pipeline_failed with error', () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_failed',
      error: 'Unrecoverable error in phase 3',
    };
    const msg = formatPipelineEvent(event);
    expect(msg).toContain('Unrecoverable error in phase 3');
  });

  it('formats pipeline_paused', () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_paused',
      reason: 'User requested pause',
    };
    const msg = formatPipelineEvent(event);
    expect(msg.toLowerCase()).toContain('pause');
  });

  it('formats pipeline_resumed', () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_resumed',
    };
    const msg = formatPipelineEvent(event);
    expect(msg.toLowerCase()).toContain('resum');
  });

  it('produces no emojis in output', () => {
    const events: PipelineNotificationEvent[] = [
      { type: 'pipeline_started', projectPath: '/test', brief: 'test' },
      { type: 'phase_started', phaseNumber: 1, phaseName: 'Test' },
      { type: 'phase_completed', phaseNumber: 1, phaseName: 'Test' },
      {
        type: 'phase_failed',
        phaseNumber: 1,
        phaseName: 'Test',
        error: 'err',
      },
      {
        type: 'escalation',
        phaseNumber: 1,
        context: 'ctx',
        options: ['a'],
      },
      { type: 'pipeline_completed', totalPhases: 1 },
      { type: 'pipeline_failed', error: 'err' },
      { type: 'pipeline_paused', reason: 'test' },
      { type: 'pipeline_resumed' },
    ];
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    for (const event of events) {
      const msg = formatPipelineEvent(event);
      expect(msg).not.toMatch(emojiRegex);
    }
  });
});
