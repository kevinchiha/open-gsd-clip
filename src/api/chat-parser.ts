/**
 * Discord command parser for natural language GSD commands.
 *
 * Iterates a prioritized list of regex patterns against the trimmed
 * input message and returns the first match as a ParsedCommand, or
 * null if no pattern matches.
 */

// ── Types ───────────────────────────────────────────────────────────

/**
 * A parsed command extracted from a user's chat message.
 */
export interface ParsedCommand {
  action: string;
  params: Record<string, unknown>;
}

// ── Pattern definitions ─────────────────────────────────────────────

interface CommandPattern {
  regex: RegExp;
  action: string;
  extractParams: (match: RegExpMatchArray) => Record<string, unknown>;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    regex: /^(?:start|build|create)\s+(.+)/i,
    action: 'gsd.start',
    extractParams: (match) => ({ brief: match[1]!.trim() }),
  },
  {
    regex: /^(?:status|progress|how'?s?\s+it\s+going)/i,
    action: 'gsd.status',
    extractParams: () => ({}),
  },
  {
    regex: /^retry\s+(?:phase\s+)?(\d+)/i,
    action: 'gsd.retry',
    extractParams: (match) => ({ phaseNumber: Number(match[1]) }),
  },
  {
    regex: /^pause/i,
    action: 'gsd.pause',
    extractParams: () => ({}),
  },
  {
    regex: /^resume/i,
    action: 'gsd.resume',
    extractParams: () => ({}),
  },
  {
    regex: /^resolve\s+(ESC-[\w-]+)\s+(.+)/i,
    action: 'gsd.override',
    extractParams: (match) => ({
      escalationId: match[1]!,
      decision: match[2]!.trim(),
    }),
  },
];

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Parse a chat message into a GSD command.
 *
 * @param message - The raw user message
 * @returns ParsedCommand if a known command pattern matches, null otherwise
 */
export function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  for (const pattern of COMMAND_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return {
        action: pattern.action,
        params: pattern.extractParams(match),
      };
    }
  }

  return null;
}
