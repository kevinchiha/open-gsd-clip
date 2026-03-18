import type { PaperclipPluginManifestV1 } from './types.js';

/**
 * Plugin manifest for Paperclip's plugin-loader.
 *
 * Paperclip discovers plugins by dynamic-importing the manifest module
 * and reading `mod.default ?? mod`. Both default and named exports are
 * provided to satisfy either import style.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: 'open-gsd-clip',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'GSD Orchestrator',
  description:
    'Automates the full GSD development pipeline via agent orchestration',
  author: 'open-gsd',
  categories: ['automation'],
  capabilities: [
    'plugin.state.read',
    'plugin.state.write',
    'events.subscribe',
    'events.emit',
    'agent.tools.register',
    'agents.read',
    'agents.invoke',
    'agent.sessions.create',
    'agent.sessions.list',
    'agent.sessions.send',
    'agent.sessions.close',
    'issues.read',
    'issues.create',
    'issues.update',
    'issue.comments.create',
    'issue.comments.read',
    'projects.read',
    'companies.read',
    'activity.log.write',
  ],
  entrypoints: {
    worker: './dist/plugin/worker.js',
  },
};

export default manifest;
export { manifest };
