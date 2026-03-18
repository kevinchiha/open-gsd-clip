/**
 * Paperclip fork() entry point.
 *
 * This module is the target of `entrypoints.worker` in the plugin manifest.
 * Paperclip's plugin-worker-manager forks this file as a child process.
 * It unconditionally starts the plugin -- no isMainModule guard needed
 * because this file is ONLY loaded when Paperclip forks it.
 */
import { startPlugin } from './index.js';

startPlugin();
