import { createChildLogger } from '../shared/logger.js';
import {
  type JsonRpcErrorResponse,
  type JsonRpcResponse,
  JsonRpcRequestSchema,
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
  description: 'Automates the full GSD development pipeline via agent orchestration',
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

function error(code: number, message: string, id: string | number | null): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

const methods: Record<string, MethodHandler> = {
  async initialize(_params, id) {
    log.info('Plugin initialized');
    return success(manifest, id);
  },

  async health(_params, id) {
    return success({ status: 'ok' }, id);
  },

  async onEvent(params, id) {
    log.info({ params }, 'Received event');
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

/**
 * Creates a JSON-RPC 2.0 method dispatcher.
 *
 * Returns an async function that accepts a raw parsed JSON message,
 * validates it as a JSON-RPC 2.0 request, routes to the appropriate handler,
 * and returns a JSON-RPC response.
 *
 * Notifications (requests without `id`) run the handler but return `undefined`.
 */
export function createRpcHandler() {
  return async (request: unknown): Promise<unknown> => {
    // Extract id early for error responses (even from invalid requests)
    const rawId = (request != null && typeof request === 'object' && 'id' in request)
      ? (request as { id: unknown }).id
      : null;
    const id = (typeof rawId === 'string' || typeof rawId === 'number' || rawId === null)
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
