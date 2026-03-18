/**
 * Append-only JSONL audit log for CEO decision recording.
 *
 * Every orchestrator decision (quality gates, revision requests,
 * re-planning, error recovery) is recorded as a single JSON line
 * in a JSONL file under the project's .planning directory.
 *
 * The log is append-only: entries are never modified or deleted.
 * Parent directories are created lazily on first write.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../shared/logger.js';
import type { AuditEntry } from './types.js';

const logger = createChildLogger('audit-log');

export class AuditLog {
  private readonly logPath: string;

  constructor(projectPath: string) {
    this.logPath = path.join(projectPath, '.planning', 'audit-log.jsonl');
  }

  /**
   * Record a CEO decision as an append-only JSONL line.
   * Auto-generates a UUID id and ISO 8601 timestamp.
   * Creates parent directories if they do not exist.
   */
  async record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const full: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, JSON.stringify(full) + '\n', 'utf-8');

    logger.info(
      { decisionType: full.decisionType, phase: full.phase, id: full.id },
      'Recorded audit entry',
    );
  }

  /**
   * Read all audit entries from the JSONL file.
   * Returns an empty array if the file does not exist.
   */
  async readAll(): Promise<AuditEntry[]> {
    let content: string;
    try {
      content = await fs.readFile(this.logPath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    return content
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /**
   * Returns the path to the audit log file (useful for testing).
   */
  getLogPath(): string {
    return this.logPath;
  }
}
