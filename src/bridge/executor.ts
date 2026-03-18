/**
 * Low-level gsd-tools.cjs invocation via execa.
 *
 * Handles:
 * - Spawning node with gsd-tools.cjs and arguments
 * - Parsing stdout as JSON
 * - Classifying errors (timeout, not found, parse, generic)
 */

import { execa } from 'execa';
import { createChildLogger } from '../shared/logger.js';
import { GsdBridgeError, GsdParseError, GsdTimeoutError, GsdToolsNotFoundError } from './errors.js';

const log = createChildLogger('bridge:executor');

/**
 * Execute a gsd-tools.cjs command and return parsed JSON output.
 *
 * @param toolsPath - Absolute path to gsd-tools.cjs
 * @param command - The gsd-tools command (e.g., 'roadmap')
 * @param args - Additional arguments (e.g., ['analyze'])
 * @param cwd - Working directory for the command
 * @param timeoutMs - Command timeout in milliseconds
 * @returns Parsed JSON from stdout
 * @throws {GsdTimeoutError} when command exceeds timeout
 * @throws {GsdToolsNotFoundError} when node or gsd-tools.cjs not found (ENOENT)
 * @throws {GsdParseError} when stdout is not valid JSON
 * @throws {GsdBridgeError} for all other failures
 */
export async function executeGsdCommand(
  toolsPath: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  const fullArgs = [toolsPath, command, ...args];
  log.debug({ command, args, cwd, timeoutMs }, 'Executing gsd-tools command');

  let stdout: string;
  try {
    const result = await execa('node', fullArgs, {
      cwd,
      timeout: timeoutMs,
    });
    stdout = result.stdout;
  } catch (error: unknown) {
    if (isExecaError(error) && error.timedOut) {
      throw new GsdTimeoutError(`${command} ${args.join(' ')}`.trim(), timeoutMs);
    }
    if (isExecaError(error) && error.code === 'ENOENT') {
      throw new GsdToolsNotFoundError([toolsPath]);
    }
    const cmd = `${command} ${args.join(' ')}`.trim();
    throw new GsdBridgeError(cmd, `Command failed: ${cmd}`, { cause: error });
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new GsdParseError(
      `${command} ${args.join(' ')}`.trim(),
      stdout,
      `Failed to parse JSON output of '${command} ${args.join(' ')}'`,
    );
  }
}

function isExecaError(
  error: unknown,
): error is { timedOut: boolean; code?: string; message: string } {
  return error !== null && typeof error === 'object' && 'timedOut' in error;
}
