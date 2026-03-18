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
 * Create a stub HostServices that logs warnings until real services arrive
 * via the initialize RPC handshake.
 */
function createStubServices(): HostServices {
  const notAvailable = () => {
    log.warn('HostServices not yet initialized -- call will be deferred');
    return Promise.resolve({ ok: false as const, error: new Error('HostServices not initialized') });
  };

  return {
    agents: {
      invoke: notAvailable as HostServices['agents']['invoke'],
    },
    issues: {
      create: notAvailable as HostServices['issues']['create'],
      createComment: notAvailable as HostServices['issues']['createComment'],
      listComments: notAvailable as HostServices['issues']['listComments'],
    },
  };
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
  // Build orchestrator config from defaults + provided overrides
  const orchConfig = {
    ...DEFAULT_CONFIG,
    ...(config?.companyId ? { companyId: config.companyId } : {}),
    ...(config?.model ? { model: config.model } : {}),
  };

  // Create PipelineRunner with stub services (real services arrive via initialize RPC)
  const stubServices = createStubServices();
  const runner = new PipelineRunner(stubServices, orchConfig);

  // Wire notification service if statusIssueId provided
  if (config?.statusIssueId && config?.companyId) {
    const notificationService = new NotificationService(
      stubServices,
      config.companyId,
      config.statusIssueId,
    );
    runner.setNotificationService(notificationService);
    log.info({ statusIssueId: config.statusIssueId }, 'Notification service wired');
  }

  const transport = createTransport(process.stdin, process.stdout);
  const handler = createRpcHandler(runner);

  transport.onMessage(handler);
  log.info('Plugin started, listening on stdin');

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
  startPlugin();
}
