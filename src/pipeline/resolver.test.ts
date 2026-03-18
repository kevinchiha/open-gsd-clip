import { describe, expect, it } from 'vitest';

import { buildExecutionPlan } from './resolver.js';

describe('buildExecutionPlan', () => {
  describe('happy paths', () => {
    it('returns empty groups for empty input', () => {
      const result = buildExecutionPlan([]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [], phaseOrder: [] },
      });
    });

    it('returns single group for single phase with no deps', () => {
      const result = buildExecutionPlan([{ phaseNumber: 1, dependsOn: [] }]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [[1]], phaseOrder: [1] },
      });
    });

    it('groups two independent phases together', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [[1, 2]], phaseOrder: [1, 2] },
      });
    });

    it('produces sequential groups for linear chain 1->2->3', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [1] },
        { phaseNumber: 3, dependsOn: [2] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1], [2], [3]],
          phaseOrder: [1, 2, 3],
        },
      });
    });

    it('groups diamond dependency correctly', () => {
      // 1 and 2 have no deps, 3 depends on both
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [] },
        { phaseNumber: 3, dependsOn: [1, 2] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1, 2], [3]],
          phaseOrder: [1, 2, 3],
        },
      });
    });

    it('handles complex mixed graph', () => {
      // Phase 1: no deps
      // Phase 2: depends on 1
      // Phase 3: no deps
      // Phase 4: depends on 2 and 3
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [1] },
        { phaseNumber: 3, dependsOn: [] },
        { phaseNumber: 4, dependsOn: [2, 3] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1, 3], [2], [4]],
          phaseOrder: [1, 3, 2, 4],
        },
      });
    });

    it('handles all phases independent (all in one group)', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [] },
        { phaseNumber: 3, dependsOn: [] },
        { phaseNumber: 4, dependsOn: [] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1, 2, 3, 4]],
          phaseOrder: [1, 2, 3, 4],
        },
      });
    });
  });

  describe('error cases', () => {
    it('detects direct circular dependency (1->2, 2->1)', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [2] },
        { phaseNumber: 2, dependsOn: [1] },
      ]);
      expect(result).toEqual({
        ok: false,
        error: {
          type: 'cyclic_dependency',
          involvedPhases: [1, 2],
        },
      });
    });

    it('detects indirect circular dependency through 3+ phases', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [3] },
        { phaseNumber: 2, dependsOn: [1] },
        { phaseNumber: 3, dependsOn: [2] },
      ]);
      expect(result).toEqual({
        ok: false,
        error: {
          type: 'cyclic_dependency',
          involvedPhases: [1, 2, 3],
        },
      });
    });

    it('detects self-referencing dependency', () => {
      const result = buildExecutionPlan([{ phaseNumber: 1, dependsOn: [1] }]);
      expect(result).toEqual({
        ok: false,
        error: {
          type: 'cyclic_dependency',
          involvedPhases: [1],
        },
      });
    });

    it('detects missing dependency reference', () => {
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [5] },
      ]);
      expect(result).toEqual({
        ok: false,
        error: {
          type: 'missing_dependency',
          phase: 2,
          missingDep: 5,
        },
      });
    });
  });

  describe('edge cases', () => {
    it('treats undefined dependsOn as no dependencies', () => {
      const result = buildExecutionPlan([
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime edge case
        { phaseNumber: 1, dependsOn: undefined as any },
      ]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [[1]], phaseOrder: [1] },
      });
    });

    it('treats null dependsOn as no dependencies', () => {
      const result = buildExecutionPlan([
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime edge case
        { phaseNumber: 1, dependsOn: null as any },
      ]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [[1]], phaseOrder: [1] },
      });
    });

    it('handles single phase with empty dependsOn array', () => {
      const result = buildExecutionPlan([{ phaseNumber: 1, dependsOn: [] }]);
      expect(result).toEqual({
        ok: true,
        value: { groups: [[1]], phaseOrder: [1] },
      });
    });
  });

  describe('real-world scenarios', () => {
    it('resolves 6-phase linear chain matching ROADMAP.md', () => {
      // Phases 1 through 6, each depending on the previous
      const result = buildExecutionPlan([
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [1] },
        { phaseNumber: 3, dependsOn: [2] },
        { phaseNumber: 4, dependsOn: [3] },
        { phaseNumber: 5, dependsOn: [4] },
        { phaseNumber: 6, dependsOn: [5] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1], [2], [3], [4], [5], [6]],
          phaseOrder: [1, 2, 3, 4, 5, 6],
        },
      });
    });
  });

  describe('determinism', () => {
    it('produces sorted groups for deterministic output', () => {
      // Input phases in reverse order
      const result = buildExecutionPlan([
        { phaseNumber: 4, dependsOn: [] },
        { phaseNumber: 3, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [] },
        { phaseNumber: 1, dependsOn: [] },
      ]);
      expect(result).toEqual({
        ok: true,
        value: {
          groups: [[1, 2, 3, 4]],
          phaseOrder: [1, 2, 3, 4],
        },
      });
    });

    it('produces same output regardless of input order', () => {
      const input1 = [
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [1] },
        { phaseNumber: 3, dependsOn: [] },
      ];
      const input2 = [
        { phaseNumber: 3, dependsOn: [] },
        { phaseNumber: 1, dependsOn: [] },
        { phaseNumber: 2, dependsOn: [1] },
      ];

      const result1 = buildExecutionPlan(input1);
      const result2 = buildExecutionPlan(input2);
      expect(result1).toEqual(result2);
    });
  });
});
