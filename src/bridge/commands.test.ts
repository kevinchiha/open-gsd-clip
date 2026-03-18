/**
 * Integration tests for the GSD bridge public API.
 *
 * These tests call the REAL gsd-tools.cjs binary against the test fixture
 * project at tests/fixtures/sample-project/. They verify that:
 * - Real CLI output matches our Zod schemas
 * - Snake_case to camelCase transformation works correctly
 * - All four bridge methods return correctly typed domain objects
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverGsdToolsPath } from './discovery.js';
import { createBridge } from './index.js';
import type { GsdBridge } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../../tests/fixtures/sample-project');

describe('bridge integration (requires gsd-tools.cjs)', () => {
  let bridge: GsdBridge;
  let toolsAvailable = false;

  beforeAll(() => {
    try {
      const toolsPath = discoverGsdToolsPath();
      bridge = createBridge({ toolsPath });
      toolsAvailable = true;
    } catch {
      // gsd-tools.cjs not available -- tests will be skipped
    }
  });

  describe('analyzeRoadmap', () => {
    it('returns object with phases array and correct phase count', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.analyzeRoadmap(FIXTURE_DIR);
      expect(result.phases).toBeInstanceOf(Array);
      expect(result.phases.length).toBe(result.phaseCount);
      expect(result.phaseCount).toBe(3); // fixture has 3 phases
    });

    it('each phase has number, name, and goal fields (camelCase)', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.analyzeRoadmap(FIXTURE_DIR);
      for (const phase of result.phases) {
        expect(phase).toHaveProperty('number');
        expect(phase).toHaveProperty('name');
        expect(phase).toHaveProperty('goal');
        expect(phase).toHaveProperty('dependsOn');
        expect(phase).toHaveProperty('planCount');
        expect(phase).toHaveProperty('summaryCount');
        expect(phase).toHaveProperty('hasContext');
        expect(phase).toHaveProperty('hasResearch');
        expect(phase).toHaveProperty('diskStatus');
        expect(phase).toHaveProperty('roadmapComplete');
      }
      // Verify NO snake_case keys
      const firstPhase = result.phases[0];
      expect(firstPhase).not.toHaveProperty('depends_on');
      expect(firstPhase).not.toHaveProperty('plan_count');
      expect(firstPhase).not.toHaveProperty('summary_count');
      expect(firstPhase).not.toHaveProperty('has_context');
      expect(firstPhase).not.toHaveProperty('has_research');
      expect(firstPhase).not.toHaveProperty('disk_status');
      expect(firstPhase).not.toHaveProperty('roadmap_complete');
    });

    it('returns correct top-level camelCase fields', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.analyzeRoadmap(FIXTURE_DIR);
      expect(result).toHaveProperty('milestones');
      expect(result).toHaveProperty('phaseCount');
      expect(result).toHaveProperty('completedPhases');
      expect(result).toHaveProperty('totalPlans');
      expect(result).toHaveProperty('totalSummaries');
      expect(result).toHaveProperty('progressPercent');
      expect(result).toHaveProperty('currentPhase');
      expect(result).toHaveProperty('nextPhase');
      expect(result).toHaveProperty('missingPhaseDetails');
      // Verify NO snake_case keys
      expect(result).not.toHaveProperty('phase_count');
      expect(result).not.toHaveProperty('completed_phases');
      expect(result).not.toHaveProperty('total_plans');
    });
  });

  describe('getPhase', () => {
    it('returns phase with correct number, name, goal, and successCriteria', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.getPhase(FIXTURE_DIR, 1);
      expect(result.found).toBe(true);
      expect(result.phaseNumber).toBe('1');
      expect(result.phaseName).toBe('Setup');
      expect(result.successCriteria).toBeInstanceOf(Array);
      expect(result.successCriteria.length).toBeGreaterThan(0);
      expect(result.section).toEqual(expect.any(String));
    });

    it('returns camelCase fields, not snake_case', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.getPhase(FIXTURE_DIR, 1);
      expect(result).toHaveProperty('phaseNumber');
      expect(result).toHaveProperty('phaseName');
      expect(result).toHaveProperty('successCriteria');
      expect(result).not.toHaveProperty('phase_number');
      expect(result).not.toHaveProperty('phase_name');
      expect(result).not.toHaveProperty('success_criteria');
    });
  });

  describe('getState', () => {
    it('returns state with milestone, status, and progress object', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.getState(FIXTURE_DIR);
      expect(result.gsdStateVersion).toBe('1.0');
      expect(result.milestone).toBe('v1.0');
      expect(result.status).toEqual(expect.any(String));
      expect(result.progress).toBeDefined();
      expect(result.progress.totalPhases).toEqual(expect.any(String));
      expect(result.progress.completedPhases).toEqual(expect.any(String));
      expect(result.progress.percent).toEqual(expect.any(String));
    });

    it('returns camelCase fields, not snake_case', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.getState(FIXTURE_DIR);
      expect(result).toHaveProperty('gsdStateVersion');
      expect(result).toHaveProperty('milestoneName');
      expect(result).toHaveProperty('stoppedAt');
      expect(result).toHaveProperty('lastUpdated');
      expect(result).toHaveProperty('lastActivity');
      expect(result).not.toHaveProperty('gsd_state_version');
      expect(result).not.toHaveProperty('milestone_name');
      expect(result).not.toHaveProperty('stopped_at');
      expect(result.progress).toHaveProperty('totalPhases');
      expect(result.progress).toHaveProperty('completedPlans');
      expect(result.progress).not.toHaveProperty('total_phases');
    });
  });

  describe('findPhase', () => {
    it('returns path with found=true for existing phase', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.findPhase(FIXTURE_DIR, 1);
      expect(result.found).toBe(true);
      expect(result.directory).toContain('01-setup');
      expect(result.phaseNumber).toBe('01');
      expect(result.phaseName).toBe('setup');
      expect(result.plans).toBeInstanceOf(Array);
      expect(result.summaries).toBeInstanceOf(Array);
    });

    it('returns found=false for non-existent phase', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.findPhase(FIXTURE_DIR, 99);
      expect(result.found).toBe(false);
    });

    it('returns camelCase fields, not snake_case', async () => {
      if (!toolsAvailable) return;

      const result = await bridge.findPhase(FIXTURE_DIR, 1);
      expect(result).toHaveProperty('phaseNumber');
      expect(result).toHaveProperty('phaseName');
      expect(result).not.toHaveProperty('phase_number');
      expect(result).not.toHaveProperty('phase_name');
    });
  });
});
