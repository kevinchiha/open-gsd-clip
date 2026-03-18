import { describe, expect, it } from 'vitest';
import type { GsdSignal } from './types.js';
import { formatSignal, parseSignal } from './parser.js';

describe('parseSignal', () => {
  it('extracts signal from text with surrounding natural language', () => {
    const text = `Hey team, here is the update:

---
GSD_SIGNAL:PROJECT_READY
phase: 1
artifacts:
  - package.json
summary: Project initialized
---

Let me know if you have questions.`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('PROJECT_READY');
    expect(result?.phase).toBe(1);
    if (result?.type === 'PROJECT_READY') {
      expect(result.artifacts).toEqual(['package.json']);
      expect(result.summary).toBe('Project initialized');
    }
  });

  it('extracts signal from text with ONLY the signal block', () => {
    const text = `---
GSD_SIGNAL:APPROVED
phase: 2
summary: Approved for production
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('APPROVED');
    expect(result?.phase).toBe(2);
  });

  it('returns null for text with no --- delimiters', () => {
    const text = 'This is just some regular text without any signal block.';
    expect(parseSignal(text)).toBeNull();
  });

  it('returns null for --- block without GSD_SIGNAL marker', () => {
    const text = `---
title: Some YAML frontmatter
date: 2024-01-01
---

This is a markdown document.`;

    expect(parseSignal(text)).toBeNull();
  });

  it('returns null for GSD_SIGNAL with unknown type', () => {
    const text = `---
GSD_SIGNAL:UNKNOWN_TYPE
phase: 1
---`;

    expect(parseSignal(text)).toBeNull();
  });

  it('returns null for valid type but missing required fields', () => {
    const text = `---
GSD_SIGNAL:VERIFY_FAILED
phase: 1
---`;
    // VERIFY_FAILED requires 'issues' field
    expect(parseSignal(text)).toBeNull();
  });

  it('extracts correct signal when multiple --- blocks exist', () => {
    const text = `---
title: Not a signal
author: Someone
---

Some text in between.

---
GSD_SIGNAL:EXECUTE_COMPLETE
phase: 3
status: success
summary: All tasks done
---

More text after.`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('EXECUTE_COMPLETE');
    if (result?.type === 'EXECUTE_COMPLETE') {
      expect(result.status).toBe('success');
      expect(result.phase).toBe(3);
    }
  });

  it('parses DISCUSS_COMPLETE signal', () => {
    const text = `---
GSD_SIGNAL:DISCUSS_COMPLETE
phase: 1
status: failure
summary: Could not reach consensus
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('DISCUSS_COMPLETE');
    if (result?.type === 'DISCUSS_COMPLETE') {
      expect(result.status).toBe('failure');
    }
  });

  it('parses VERIFY_FAILED signal', () => {
    const text = `---
GSD_SIGNAL:VERIFY_FAILED
phase: 2
issues:
  - Tests failing
  - Type errors found
summary: Verification did not pass
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('VERIFY_FAILED');
    if (result?.type === 'VERIFY_FAILED') {
      expect(result.issues).toEqual(['Tests failing', 'Type errors found']);
    }
  });

  it('parses DECISION_NEEDED signal', () => {
    const text = `---
GSD_SIGNAL:DECISION_NEEDED
phase: 1
context: Which auth strategy to use?
options:
  - JWT
  - Session cookies
  - OAuth
summary: Auth decision required
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('DECISION_NEEDED');
    if (result?.type === 'DECISION_NEEDED') {
      expect(result.context).toBe('Which auth strategy to use?');
      expect(result.options).toEqual(['JWT', 'Session cookies', 'OAuth']);
    }
  });

  it('parses AGENT_ERROR signal', () => {
    const text = `---
GSD_SIGNAL:AGENT_ERROR
phase: 1
error: Process exited with code 1
command: npm test
summary: Test runner crashed
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('AGENT_ERROR');
    if (result?.type === 'AGENT_ERROR') {
      expect(result.error).toBe('Process exited with code 1');
      expect(result.command).toBe('npm test');
    }
  });

  it('preserves optional fields when present', () => {
    const text = `---
GSD_SIGNAL:PROJECT_READY
phase: 1
artifacts:
  - file1.ts
  - file2.ts
summary: All set
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    if (result?.type === 'PROJECT_READY') {
      expect(result.artifacts).toEqual(['file1.ts', 'file2.ts']);
      expect(result.summary).toBe('All set');
    }
  });

  it('handles absent optional fields correctly', () => {
    const text = `---
GSD_SIGNAL:PROJECT_READY
phase: 1
---`;

    const result = parseSignal(text);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('PROJECT_READY');
    if (result?.type === 'PROJECT_READY') {
      expect(result.artifacts).toBeUndefined();
      expect(result.summary).toBeUndefined();
    }
  });
});

describe('formatSignal', () => {
  it('produces a valid signal block string', () => {
    const signal: GsdSignal = {
      type: 'PROJECT_READY',
      phase: 1,
      summary: 'Ready to go',
    };

    const formatted = formatSignal(signal);
    expect(formatted).toContain('---');
    expect(formatted).toContain('GSD_SIGNAL:PROJECT_READY');
    expect(formatted).toContain('phase: 1');
    expect(formatted).toContain("summary: Ready to go");
  });

  it('round-trips: formatSignal then parseSignal returns equivalent signal', () => {
    const original: GsdSignal = {
      type: 'DECISION_NEEDED',
      phase: 3,
      context: 'Which framework?',
      options: ['Next.js', 'Remix', 'Astro'],
      summary: 'Framework choice',
    };

    const formatted = formatSignal(original);
    const parsed = parseSignal(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(original);
  });

  it('round-trips STALE_HEARTBEAT signal', () => {
    const original: GsdSignal = {
      type: 'STALE_HEARTBEAT',
      phase: 1,
      agent_id: 'executor-01',
      elapsed_ms: 60000,
    };

    const formatted = formatSignal(original);
    const parsed = parseSignal(formatted);
    expect(parsed).toEqual(original);
  });

  it('round-trips AGENT_ERROR signal with optional command', () => {
    const original: GsdSignal = {
      type: 'AGENT_ERROR',
      phase: 2,
      error: 'Build failed',
      command: 'npm run build',
      summary: 'CI failure',
    };

    const formatted = formatSignal(original);
    const parsed = parseSignal(formatted);
    expect(parsed).toEqual(original);
  });

  it('round-trips signal without optional fields', () => {
    const original: GsdSignal = {
      type: 'APPROVED',
      phase: 5,
    };

    const formatted = formatSignal(original);
    const parsed = parseSignal(formatted);
    expect(parsed).toEqual(original);
  });
});
