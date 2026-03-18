import { ACTION_HANDLERS } from '../api/actions.js';
import { parseCommand } from '../api/chat-parser.js';
import type { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { createChildLogger } from '../shared/logger.js';
import { manifest } from './manifest.js';
import {
  type JsonRpcErrorResponse,
  JsonRpcRequestSchema,
  type JsonRpcResponse,
  RPC_ERRORS,
} from './types.js';

const log = createChildLogger('rpc-handler');

type MethodHandler = (
  params: unknown,
  id: string | number | null,
) => Promise<JsonRpcResponse | JsonRpcErrorResponse>;

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
      return success(
        {
          ok: true,
          supportedMethods: [
            'initialize',
            'health',
            'shutdown',
            'onEvent',
            'executeAction',
            'performAction',
            'getData',
          ],
        },
        id,
      );
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

      // Handle chat.message events for Discord command routing
      if (event.type === 'chat.message') {
        const msg = event.data as { content?: string; channelId?: string; userId?: string } | undefined;
        const content = msg?.content?.trim();

        if (!content) {
          return success({ received: true }, id);
        }

        if (!orchestrator) {
          return success({ received: true, reply: 'GSD pipeline not initialized. Please wait for startup.' }, id);
        }

        const command = parseCommand(content);
        if (command) {
          const actionHandler = ACTION_HANDLERS[command.action];
          if (actionHandler) {
            try {
              const result = await actionHandler(command.params, orchestrator);
              return success({ received: true, reply: result }, id);
            } catch (err) {
              return success({ received: true, reply: { success: false, error: (err as Error).message } }, id);
            }
          }
        }

        // Unrecognized command -- return help
        return success({
          received: true,
          reply: {
            success: true,
            data: {
              message: 'Available commands: start <brief>, status, retry <phase>, pause, resume, resolve <ESC-id> <decision>',
            },
          },
        }, id);
      }

      // Default: acknowledge unknown event types
      return success({ received: true }, id);
    },

    async getState(_params, id) {
      return success({ status: 'not_implemented' }, id);
    },

    async executeAction(params, id) {
      const { action, args } = (params as { action: string; args: unknown } | { action?: undefined; args?: undefined }) ?? {};

      if (!action) {
        return error(RPC_ERRORS.INVALID_PARAMS, 'Missing action field', id);
      }

      if (!orchestrator) {
        return error(RPC_ERRORS.INTERNAL_ERROR, 'Pipeline runner not initialized', id);
      }

      const handler = ACTION_HANDLERS[action];
      if (!handler) {
        return error(RPC_ERRORS.METHOD_NOT_FOUND, `Unknown action: ${action}`, id);
      }

      try {
        const result = await handler(args, orchestrator);
        return success(result, id);
      } catch (err) {
        return error(RPC_ERRORS.INTERNAL_ERROR, (err as Error).message, id);
      }
    },

    async performAction(params, id) {
      const { key, params: actionParams } = (params as { key: string; params?: Record<string, unknown>; renderEnvironment?: unknown } | { key?: undefined; params?: undefined }) ?? {};

      if (!key) {
        return error(RPC_ERRORS.INVALID_PARAMS, 'Missing key field', id);
      }

      if (!orchestrator) {
        return error(RPC_ERRORS.INTERNAL_ERROR, 'Pipeline runner not initialized', id);
      }

      // Map bridge key to action handler (key IS the action name, e.g. "gsd.start")
      const handler = ACTION_HANDLERS[key];
      if (!handler) {
        return error(RPC_ERRORS.METHOD_NOT_FOUND, `Unknown action: ${key}`, id);
      }

      try {
        const result = await handler(actionParams, orchestrator);
        return success(result, id);
      } catch (err) {
        return error(RPC_ERRORS.INTERNAL_ERROR, (err as Error).message, id);
      }
    },

    async getData(params, id) {
      const { key } = (params as { key: string }) ?? {};
      if (key === 'debug') {
        return success({
          hasOrchestrator: !!orchestrator,
          trackedRuns: orchestrator ? Array.from((orchestrator as any).trackedRuns?.entries?.() ?? []) : [],
          hasPoller: !!(orchestrator as any)?.completionPoller,
          companyId: (orchestrator as any)?.companyId ?? 'unknown',
        }, id);
      }
      return success({ key, status: 'not_implemented' }, id);
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
