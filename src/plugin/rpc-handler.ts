import type { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { createChildLogger } from '../shared/logger.js';
import {
  type JsonRpcErrorResponse,
  JsonRpcRequestSchema,
  type JsonRpcResponse,
  type PaperclipPluginManifestV1,
  RPC_ERRORS,
} from './types.js';

const log = createChildLogger('rpc-handler');

/**
 * Plugin manifest returned by the `initialize` method.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: '@open-gsd/clip',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'GSD Orchestrator',
  description:
    'Automates the full GSD development pipeline via agent orchestration',
  categories: ['automation'],
  capabilities: [
    'data.read',
    'data.write',
    'plugin.state',
    'events.subscribe',
    'agent.tools.register',
  ],
  entrypoints: {
    worker: './dist/plugin/worker.js',
  },
};

type MethodHandler = (
  params: unknown,
  id: string | number | null,
) => Promise<JsonRpcResponse>;

function success(result: unknown, id: string | number | null): JsonRpcResponse {
  return { jsonrpc: '2.0', result, id };
}

function error(
  code: number,
  message: string,
  id: string | number | null,
): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

/**
 * Build method handlers, optionally wired to an orchestrator instance.
 */
function buildMethods(
  orchestrator?: PipelineRunner | null,
): Record<string, MethodHandler> {
  return {
    async initialize(_params, id) {
      log.info('Plugin initialized');
      return success(manifest, id);
    },

    async health(_params, id) {
      return success({ status: 'ok' }, id);
    },

    async onEvent(params, id) {
      const event = params as { type: string; data: unknown } | undefined;

      if (!event?.type) {
        log.debug({ params }, 'Received event without type');
        return success({ received: true }, id);
      }

      log.debug({ eventType: event.type }, 'Received event');

      // Handle run status events for agent completion detection
      if (event.type === 'heartbeat.run.status') {
        const run = event.data as {
          status: string;
          agentId: string;
          runId: string;
          issueId?: string;
        };

        if (orchestrator) {
          if (run.status === 'running' && run.issueId) {
            // Record activity for health monitoring
            orchestrator.recordActivity(run.issueId);
          } else if (run.status === 'succeeded' || run.status === 'failed') {
            // Dispatch terminal events to orchestrator
            log.info(
              {
                status: run.status,
                agentId: run.agentId,
                runId: run.runId,
                issueId: run.issueId,
              },
              'Agent run completed, dispatching to orchestrator',
            );

            void orchestrator.handleAgentCompletion(run);
          }
        } else {
          // No orchestrator -- log terminal states only
          if (run.status === 'succeeded' || run.status === 'failed') {
            log.info(
              {
                status: run.status,
                agentId: run.agentId,
                runId: run.runId,
                issueId: run.issueId,
              },
              'Agent run completed (no orchestrator attached)',
            );
          }
        }

        return success({ received: true, status: run.status }, id);
      }

      // Default: acknowledge unknown event types
      return success({ received: true }, id);
    },

    async getState(_params, id) {
      return success({ status: 'not_implemented' }, id);
    },

    async executeAction(_params, id) {
      return success({ status: 'not_implemented' }, id);
    },

    async registerTools(_params, id) {
      return success({ status: 'not_implemented' }, id);
    },

    async configure(_params, id) {
      return success({ status: 'not_implemented' }, id);
    },

    async shutdown(_params, id) {
      log.info('Plugin shutting down');
      return success({ status: 'shutting_down' }, id);
    },
  };
}

/**
 * Creates a JSON-RPC 2.0 method dispatcher.
 *
 * Optionally accepts a PipelineRunner instance. When provided, onEvent
 * dispatches agent completion events to the orchestrator. When omitted,
 * events are logged but not dispatched (backward compatible).
 *
 * Returns an async function that accepts a raw parsed JSON message,
 * validates it as a JSON-RPC 2.0 request, routes to the appropriate handler,
 * and returns a JSON-RPC response.
 *
 * Notifications (requests without `id`) run the handler but return `undefined`.
 */
export function createRpcHandler(orchestrator?: PipelineRunner | null) {
  const methods = buildMethods(orchestrator);
  return async (request: unknown): Promise<unknown> => {
    // Extract id early for error responses (even from invalid requests)
    const rawId =
      request != null && typeof request === 'object' && 'id' in request
        ? (request as { id: unknown }).id
        : null;
    const id =
      typeof rawId === 'string' || typeof rawId === 'number' || rawId === null
        ? rawId
        : null;

    // Validate against JSON-RPC 2.0 schema
    const parsed = JsonRpcRequestSchema.safeParse(request);
    if (!parsed.success) {
      return error(RPC_ERRORS.INVALID_REQUEST, 'Invalid Request', id);
    }

    const { method, params } = parsed.data;
    const isNotification = parsed.data.id === undefined;

    // Route to method handler
    const handler = methods[method];
    if (!handler) {
      if (isNotification) return undefined;
      return error(RPC_ERRORS.METHOD_NOT_FOUND, 'Method not found', id);
    }

    // For notifications, run handler but don't return response
    if (isNotification) {
      await handler(params, null as unknown as string);
      return undefined;
    }

    return handler(params, parsed.data.id as string | number | null);
  };
}

export { manifest };
