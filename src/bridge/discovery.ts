/**
 * Auto-discovery of gsd-tools.cjs path.
 *
 * 3-step fallback chain:
 * 1. GSD_TOOLS_PATH env var
 * 2. ~/.claude/get-shit-done/bin/gsd-tools.cjs
 * 3. Resolve from 'get-shit-done-cc' package
 * 4. Throw GsdToolsNotFoundError
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../shared/logger.js';
import { GsdToolsNotFoundError } from './errors.js';

const log = createChildLogger('bridge:discovery');

/**
 * Discover the path to gsd-tools.cjs using a 3-step fallback chain.
 * Synchronous -- file existence checks are fast.
 *
 * @returns Absolute path to gsd-tools.cjs
 * @throws {GsdToolsNotFoundError} when gsd-tools.cjs cannot be found
 */
export function discoverGsdToolsPath(): string {
  const searched: string[] = [];

  // Step 1: GSD_TOOLS_PATH env var
  const envPath = process.env.GSD_TOOLS_PATH;
  if (envPath) {
    searched.push(envPath);
    if (fs.existsSync(envPath)) {
      log.debug({ path: envPath }, 'Found gsd-tools.cjs via GSD_TOOLS_PATH env var');
      return envPath;
    }
    log.debug({ path: envPath }, 'GSD_TOOLS_PATH set but file not found');
  }

  // Step 2: Default path (~/.claude/get-shit-done/bin/gsd-tools.cjs)
  const defaultPath = path.join(os.homedir(), '.claude', 'get-shit-done', 'bin', 'gsd-tools.cjs');
  searched.push(defaultPath);
  if (fs.existsSync(defaultPath)) {
    log.debug({ path: defaultPath }, 'Found gsd-tools.cjs at default path');
    return defaultPath;
  }
  log.debug({ path: defaultPath }, 'gsd-tools.cjs not at default path');

  // Step 3: Resolve from 'get-shit-done-cc' package
  try {
    const resolved = import.meta.resolve('get-shit-done-cc');
    // Derive the bin path from the package root
    const pkgDir = path.dirname(resolved.replace('file://', ''));
    const pkgToolsPath = path.join(pkgDir, 'bin', 'gsd-tools.cjs');
    searched.push(pkgToolsPath);
    if (fs.existsSync(pkgToolsPath)) {
      log.debug({ path: pkgToolsPath }, 'Found gsd-tools.cjs via package resolve');
      return pkgToolsPath;
    }
    log.debug({ path: pkgToolsPath }, 'Package resolved but gsd-tools.cjs not at expected path');
  } catch {
    searched.push('get-shit-done-cc (package not installed)');
    log.debug('get-shit-done-cc package not resolvable');
  }

  // Step 4: Not found
  throw new GsdToolsNotFoundError(searched);
}
