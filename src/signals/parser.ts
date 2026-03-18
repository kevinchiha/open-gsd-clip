import * as yaml from 'js-yaml';
import { createChildLogger } from '../shared/logger.js';
import { signalSchemas } from './schemas.js';
import { SIGNAL_TYPES } from './types.js';
import type { GsdSignal, SignalType } from './types.js';

const log = createChildLogger('signal-parser');

/**
 * Set of valid signal type strings for O(1) lookup.
 */
const validTypes = new Set<string>(SIGNAL_TYPES);

/**
 * Regex to find --- delimited blocks in text.
 * Non-greedy to avoid matching across multiple blocks.
 * Anchored to line starts via the `m` flag.
 */
const BLOCK_REGEX = /^---\n([\s\S]*?\n)---$/gm;

/**
 * Extract and validate a GSD signal from text.
 *
 * Scans the text for `---` delimited blocks containing a `GSD_SIGNAL:<TYPE>`
 * marker on the first line. Parses the remaining YAML content and validates
 * against the type-specific Zod schema.
 *
 * @param text - Text that may contain a GSD signal block
 * @returns Parsed and validated signal, or null if no valid signal found
 */
export function parseSignal(text: string): GsdSignal | null {
  // Reset regex state (global flag requires this)
  BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_REGEX.exec(text)) !== null) {
    const blockContent = match[1];
    const firstNewline = blockContent.indexOf('\n');
    const firstLine =
      firstNewline === -1 ? blockContent.trim() : blockContent.slice(0, firstNewline).trim();

    // Check for GSD_SIGNAL marker
    if (!firstLine.startsWith('GSD_SIGNAL:')) {
      continue;
    }

    // Extract signal type from marker line
    const signalType = firstLine.slice('GSD_SIGNAL:'.length).trim();

    // Validate signal type
    if (!validTypes.has(signalType)) {
      log.warn({ signalType }, 'Unknown signal type');
      return null;
    }

    // Strip the marker line and parse remaining YAML
    const yamlContent =
      firstNewline === -1 ? '' : blockContent.slice(firstNewline + 1);

    let parsed: Record<string, unknown>;
    try {
      const loaded = yaml.load(yamlContent);
      parsed = (typeof loaded === 'object' && loaded !== null
        ? loaded
        : {}) as Record<string, unknown>;
    } catch {
      log.warn({ signalType }, 'Failed to parse YAML content');
      return null;
    }

    // Add the type field back (it was on the marker line, not in YAML)
    parsed.type = signalType;

    // Validate against type-specific schema
    const schema = signalSchemas[signalType as SignalType];
    const result = schema.safeParse(parsed);

    if (!result.success) {
      log.warn(
        { signalType, errors: result.error.issues },
        'Signal validation failed',
      );
      return null;
    }

    return result.data as GsdSignal;
  }

  return null;
}

/**
 * Format a GSD signal into a `---` delimited block string.
 *
 * Produces a string in the format:
 * ```
 * ---
 * GSD_SIGNAL:<TYPE>
 * <yaml-serialized fields>
 * ---
 * ```
 *
 * The `type` field is placed on the marker line and excluded from YAML body.
 *
 * @param signal - Validated GSD signal to format
 * @returns Formatted signal block string
 */
export function formatSignal(signal: GsdSignal): string {
  const { type, ...fields } = signal;

  // Only dump YAML if there are fields beyond the type
  const hasFields = Object.keys(fields).length > 0;
  const yamlBody = hasFields
    ? yaml.dump(fields, { lineWidth: -1, noRefs: true, sortKeys: true })
    : '';

  return `---\nGSD_SIGNAL:${type}\n${yamlBody}---\n`;
}
