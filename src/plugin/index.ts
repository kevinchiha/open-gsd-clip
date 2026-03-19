import type { HostServices } from '../agents/types.js';
import { NotificationService } from '../notifications/notification-service.js';
import { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { DEFAULT_CONFIG } from '../orchestrator/types.js';
import { createChildLogger } from '../shared/logger.js';
import { createRpcHandler, manifest } from './rpc-handler.js';
import { createTransport } from './rpc-transport.js';

const log = createChildLogger('plugin');

export { manifest };

/**
 * Create HostServices backed by direct HTTP calls to the Paperclip REST API.
 * This bypasses the plugin SDK's host service channel and calls Paperclip directly.
 */
function createHttpServices(): HostServices {
  const port = process.env.PAPERCLIP_PORT || '3100';
  const base = `http://127.0.0.1:${port}/api`;

  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false as const, error: new Error(`${res.status}: ${text}`) };
    }
    const data = await res.json();
    return { ok: true as const, value: data };
  }

  return {
    agents: {
      invoke: async (params) => {
        const result = await api('POST', `/agents/${params.agentId}/wakeup`, {
          reason: params.reason,
          prompt: params.prompt,
        });
        if (!result.ok) return result;
        return { ok: true, value: { runId: result.value?.runId || result.value?.id || 'unknown' } };
      },
    },
    issues: {
      create: async (params) => {
        return api('POST', `/companies/${params.companyId}/issues`, {
          title: params.title,
          description: params.description,
          status: params.status,
          priority: params.priority,
          assigneeAgentId: params.assigneeAgentId,
          executionWorkspaceSettings: params.executionWorkspaceSettings,
        });
      },
      createComment: async (params) => {
        return api('POST', `/issues/${params.issueId}/comments`, {
          body: params.body,
        });
      },
      listComments: async (params) => {
        return api('GET', `/issues/${params.issueId}/comments`);
      },
    },
  };
}

/**
 * Auto-detect the first company ID from the Paperclip API.
 */
async function detectCompanyId(): Promise<string | null> {
  const port = process.env.PAPERCLIP_PORT || '3100';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/companies`);
    if (!res.ok) return null;
    const companies = (await res.json()) as Array<{ id: string; name: string }>;
    if (companies.length > 0) {
      log.info({ companyId: companies[0].id, name: companies[0].name }, 'Auto-detected company');
      return companies[0].id;
    }
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Failed to auto-detect companyId');
  }
  return null;
}

/**
 * Start the plugin worker.
 *
 * Creates a PipelineRunner (idle until gsd.start is called), wires it to
 * the RPC handler via JSON-RPC transport over stdin/stdout, and begins
 * listening for requests.
 *
 * @param config - Optional overrides for companyId, model, and statusIssueId.
 * @returns A cleanup function that closes the transport and destroys the runner.
 */
export function startPlugin(config?: {
  companyId?: string;
  model?: string;
  statusIssueId?: string;
}) {
  // Start with empty companyId — detect lazily before first use
  const companyId = config?.companyId || '';

  // Build orchestrator config from defaults + provided overrides
  const orchConfig = {
    ...DEFAULT_CONFIG,
    companyId,
    ...(config?.model ? { model: config.model } : {}),
  };

  // Create PipelineRunner with HTTP-backed services
  const httpServices = createHttpServices();
  const runner = new PipelineRunner(httpServices, orchConfig);

  // Auto-detect companyId in background and update runner
  if (!companyId) {
    detectCompanyId().then((detected) => {
      if (detected) {
        runner.setCompanyId(detected);
      }
    }).catch(() => {});
  }

  // Restore persisted state from previous run (crash recovery)
  runner.restoreState().then((restored) => {
    if (restored) {
      log.info('Pipeline state restored from previous session');
    }
  }).catch(() => {});

  const stubServices = httpServices; // alias for notification wiring below
  // (keeping variable name for minimal diff)

  // Wire notification service if statusIssueId provided
  if (config?.statusIssueId && companyId) {
    const notificationService = new NotificationService(
      stubServices,
      companyId,
      config.statusIssueId,
    );
    runner.setNotificationService(notificationService);
    log.info({ statusIssueId: config.statusIssueId }, 'Notification service wired');
  }

  const transport = createTransport(process.stdin, process.stdout);
  const handler = createRpcHandler(runner);

  transport.onMessage(handler);
  log.info({ companyId }, 'Plugin started, listening on stdin');

  // Clean exit when stdin closes (host disconnected)
  process.stdin.on('end', () => {
    log.info('stdin closed, shutting down');
    transport.close();
    process.exit(0);
  });

  return () => {
    runner.destroy();
    transport.close();
  };
}

// Auto-start when run directly
// In ESM, we detect if this module is the entry point by checking if
// process.argv[1] resolves to this file (tsx rewrites the path)
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('/plugin/index.ts') ||
    process.argv[1].endsWith('/plugin/index.js'));

if (isMainModule) {
  void startPlugin();
}
