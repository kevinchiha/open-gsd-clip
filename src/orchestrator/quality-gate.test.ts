/**
 * Tests for CEO quality gate review and revision logic.
 *
 * Verifies that context builders produce correct AgentContext objects
 * and that issue descriptions contain all required fields, signal
 * templates, and CEO feedback sections.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCeoReviewContext,
  buildReviewIssueDescription,
  buildRevisionContext,
  buildRevisionIssueDescription,
} from './quality-gate.js';

describe('quality-gate', () => {
  const projectPath = '/home/user/my-project';
  const phaseNumber = 2;

  describe('buildCeoReviewContext', () => {
    it('returns AgentContext with ceo role', () => {
      const ctx = buildCeoReviewContext(projectPath, phaseNumber);

      expect(ctx.role).toBe('ceo');
      expect(ctx.projectPath).toBe(projectPath);
      expect(ctx.phaseNumber).toBe(phaseNumber);
      expect(ctx.gsdCommand).toBe('review-context');
    });
  });

  describe('buildReviewIssueDescription', () => {
    const contextMdPath = '.planning/phases/02-something/CONTEXT.md';

    it('contains CEO Quality Gate Review header', () => {
      const desc = buildReviewIssueDescription(
        projectPath,
        phaseNumber,
        contextMdPath,
      );
      expect(desc).toContain('## CEO Quality Gate Review');
    });

    it('contains phase number', () => {
      const desc = buildReviewIssueDescription(
        projectPath,
        phaseNumber,
        contextMdPath,
      );
      expect(desc).toContain(`${phaseNumber}`);
    });

    it('contains CONTEXT.md path', () => {
      const desc = buildReviewIssueDescription(
        projectPath,
        phaseNumber,
        contextMdPath,
      );
      expect(desc).toContain(contextMdPath);
    });

    it('contains APPROVED signal template', () => {
      const desc = buildReviewIssueDescription(
        projectPath,
        phaseNumber,
        contextMdPath,
      );
      expect(desc).toContain('GSD_SIGNAL:APPROVED');
    });

    it('contains REVISION_NEEDED signal template', () => {
      const desc = buildReviewIssueDescription(
        projectPath,
        phaseNumber,
        contextMdPath,
      );
      expect(desc).toContain('GSD_SIGNAL:REVISION_NEEDED');
    });
  });

  describe('buildRevisionContext', () => {
    const feedback = 'Missing error handling for edge cases';

    it('returns AgentContext with discusser role', () => {
      const ctx = buildRevisionContext(projectPath, phaseNumber, feedback);

      expect(ctx.role).toBe('discusser');
      expect(ctx.projectPath).toBe(projectPath);
      expect(ctx.phaseNumber).toBe(phaseNumber);
    });

    it('has gsdCommand containing phase number', () => {
      const ctx = buildRevisionContext(projectPath, phaseNumber, feedback);

      expect(ctx.gsdCommand).toContain(`${phaseNumber}`);
    });
  });

  describe('buildRevisionIssueDescription', () => {
    const feedback = 'The context document lacks concrete API contracts';
    const gsdCommand = `/gsd:discuss-phase ${phaseNumber} --auto`;

    it('contains Previous Review Feedback section with feedback text', () => {
      const desc = buildRevisionIssueDescription(
        projectPath,
        phaseNumber,
        feedback,
        gsdCommand,
      );
      expect(desc).toContain('## Previous Review Feedback');
      expect(desc).toContain(feedback);
    });

    it('contains DISCUSS_COMPLETE signal template', () => {
      const desc = buildRevisionIssueDescription(
        projectPath,
        phaseNumber,
        feedback,
        gsdCommand,
      );
      expect(desc).toContain('GSD_SIGNAL:DISCUSS_COMPLETE');
    });

    it('contains project path', () => {
      const desc = buildRevisionIssueDescription(
        projectPath,
        phaseNumber,
        feedback,
        gsdCommand,
      );
      expect(desc).toContain(projectPath);
    });
  });
});
