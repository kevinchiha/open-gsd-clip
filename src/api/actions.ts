/**
 * Action handler registry for all 7 GSD API endpoints.
 *
 * Each handler validates input via Zod schemas, delegates to
 * PipelineRunner methods, and wraps results in ActionResult.
 * All handlers catch thrown errors to guarantee a well-formed response.
 */

import type { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { OverrideSchema, RetrySchema, StartSchema } from './schemas.js';

// ── Types ───────────────────────────────────────────────────────────

/**
 * Standardized response from every action handler.
 */
export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Function signature for action handlers.
 */
export type ActionHandler = (
  params: unknown,
  runner: PipelineRunner,
) => Promise<ActionResult>;

// ── Handlers ────────────────────────────────────────────────────────

export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  'gsd.start': async (params, runner) => {
    const parsed = StartSchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    try {
      await runner.start(parsed.data.projectPath, parsed.data.brief);
      return { success: true, data: { status: 'started' } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.status': async (_params, runner) => {
    try {
      const state = runner.getState();
      if (!state) {
        return { success: false, error: 'Pipeline not started' };
      }
      return { success: true, data: state };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.phases': async (_params, runner) => {
    try {
      const state = runner.getState();
      if (!state) {
        return { success: false, error: 'Pipeline not started' };
      }
      if (!state.executionPlan) {
        return { success: false, error: 'No execution plan available' };
      }
      return {
        success: true,
        data: {
          phases: state.phases,
          executionPlan: state.executionPlan,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.retry': async (params, runner) => {
    const parsed = RetrySchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    try {
      await runner.retryPhase(parsed.data.phaseNumber, parsed.data.fromStep);
      return { success: true, data: { status: 'retrying' } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.override': async (params, runner) => {
    const parsed = OverrideSchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    try {
      await runner.resolveEscalation(
        parsed.data.escalationId,
        parsed.data.decision,
      );
      return { success: true, data: { status: 'resolved' } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.pause': async (_params, runner) => {
    try {
      await runner.pause();
      return { success: true, data: { status: 'paused' } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  'gsd.resume': async (_params, runner) => {
    try {
      await runner.resume();
      return { success: true, data: { status: 'resumed' } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};
