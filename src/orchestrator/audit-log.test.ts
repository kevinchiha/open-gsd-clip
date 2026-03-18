/**
 * Tests for the append-only JSONL audit log.
 *
 * Verifies that CEO decisions are recorded as JSON lines
 * with auto-generated UUIDs and ISO timestamps, that parent
 * directories are created lazily, and that readAll handles
 * missing files gracefully.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from './audit-log.js';
import type { AuditEntry } from './types.js';

// UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 8601 pattern
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

/** Helper to build a minimal audit entry (without id/timestamp). */
function makeEntry(overrides: Partial<Omit<AuditEntry, 'id' | 'timestamp'>> = {}): Omit<AuditEntry, 'id' | 'timestamp'> {
  return {
    phase: 1,
    decisionType: 'quality_gate',
    context: 'test context',
    optionsConsidered: ['option-a', 'option-b'],
    choice: 'option-a',
    reasoning: 'it was the best choice',
    ...overrides,
  };
}

describe('AuditLog', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-log-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('record', () => {
    it('writes a JSONL line with all required fields', async () => {
      const log = new AuditLog(tmpDir);
      await log.record(makeEntry());

      const content = await fs.readFile(log.getLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry: AuditEntry = JSON.parse(lines[0]);
      expect(entry.phase).toBe(1);
      expect(entry.decisionType).toBe('quality_gate');
      expect(entry.context).toBe('test context');
      expect(entry.optionsConsidered).toEqual(['option-a', 'option-b']);
      expect(entry.choice).toBe('option-a');
      expect(entry.reasoning).toBe('it was the best choice');
    });

    it('auto-generates UUID id and ISO timestamp', async () => {
      const log = new AuditLog(tmpDir);
      await log.record(makeEntry());

      const content = await fs.readFile(log.getLogPath(), 'utf-8');
      const entry: AuditEntry = JSON.parse(content.trim());
      expect(entry.id).toMatch(UUID_RE);
      expect(entry.timestamp).toMatch(ISO_RE);
    });

    it('creates parent directories lazily', async () => {
      const deepPath = path.join(tmpDir, 'nested', 'deep', 'project');
      const log = new AuditLog(deepPath);

      // Should not throw even though .planning/ doesn't exist
      await expect(log.record(makeEntry())).resolves.toBeUndefined();

      const content = await fs.readFile(log.getLogPath(), 'utf-8');
      expect(content.trim()).not.toBe('');
    });
  });

  describe('readAll', () => {
    it('returns parsed entries from JSONL file', async () => {
      const log = new AuditLog(tmpDir);
      await log.record(makeEntry({ phase: 1, choice: 'alpha' }));
      await log.record(makeEntry({ phase: 2, choice: 'beta' }));
      await log.record(makeEntry({ phase: 3, choice: 'gamma' }));

      const entries = await log.readAll();
      expect(entries).toHaveLength(3);
      expect(entries[0].phase).toBe(1);
      expect(entries[0].choice).toBe('alpha');
      expect(entries[1].phase).toBe(2);
      expect(entries[1].choice).toBe('beta');
      expect(entries[2].phase).toBe(3);
      expect(entries[2].choice).toBe('gamma');
    });

    it('returns empty array for missing file', async () => {
      const log = new AuditLog(path.join(tmpDir, 'nonexistent'));
      const entries = await log.readAll();
      expect(entries).toEqual([]);
    });
  });

  describe('append-only behavior', () => {
    it('multiple records append to same file', async () => {
      const log = new AuditLog(tmpDir);
      await log.record(makeEntry({ choice: 'first' }));
      await log.record(makeEntry({ choice: 'second' }));

      const content = await fs.readFile(log.getLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entries = await log.readAll();
      expect(entries).toHaveLength(2);
      expect(entries[0].choice).toBe('first');
      expect(entries[1].choice).toBe('second');
    });
  });
});
