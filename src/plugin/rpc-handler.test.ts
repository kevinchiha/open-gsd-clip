import { describe, expect, it, vi } from 'vitest';
import { createRpcHandler } from './rpc-handler.js';

// Suppress logger output in tests
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * Create a mock PipelineRunner with all methods used by RPC handler + action handlers.
 */
function createMockRunner() {
  return {
    handleAgentCompletion: vi.fn().mockResolvedValue(undefined),
    recordActivity: vi.fn(),
    getState: vi.fn().mockReturnValue({ status: 'running', phases: [] }),
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    retryPhase: vi.fn().mockResolvedValue(undefined),
    resolveEscalation: vi.fn().mockResolvedValue(undefined),
    setNotificationService: vi.fn(),
    getTokenSummary: vi.fn().mockReturnValue([]),
    getPendingEscalations: vi.fn().mockReturnValue([]),
    destroy: vi.fn(),
  };
}

describe('rpc-handler', () => {
  const handler = createRpcHandler();

  describe('initialize', () => {
    it('returns manifest with correct fields', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          id: '@open-gsd/clip',
          apiVersion: 1,
          version: expect.any(String),
          displayName: expect.any(String),
          capabilities: expect.any(Array),
        },
      });
    });
  });

  describe('health', () => {
    it('returns ok status', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'health',
        id: 2,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 2,
      });
    });
  });

  describe('onEvent', () => {
    it('returns received: true for unknown event types', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'issue.created', data: {} },
        id: 3,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { received: true },
        id: 3,
      });
    });

    it('returns status for running heartbeat.run.status event', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'running',
            agentId: 'agent-1',
            runId: 'run-1',
          },
        },
        id: 20,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 20,
        result: { received: true, status: 'running' },
      });
    });

    it('returns status for succeeded heartbeat.run.status event', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'succeeded',
            agentId: 'agent-1',
            runId: 'run-1',
            issueId: 'issue-1',
          },
        },
        id: 21,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 21,
        result: { received: true, status: 'succeeded' },
      });
    });

    it('returns status for failed heartbeat.run.status event', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'failed',
            agentId: 'agent-2',
            runId: 'run-2',
          },
        },
        id: 22,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 22,
        result: { received: true, status: 'failed' },
      });
    });
  });

  describe('onEvent with orchestrator', () => {
    it('calls handleAgentCompletion on succeeded event', async () => {
      const mockOrchestrator = {
        handleAgentCompletion: vi.fn().mockResolvedValue(undefined),
        recordActivity: vi.fn(),
      };

      const handlerWithOrch = createRpcHandler(
        mockOrchestrator as unknown as Parameters<typeof createRpcHandler>[0],
      );

      await handlerWithOrch({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'succeeded',
            agentId: 'agent-1',
            runId: 'run-1',
            issueId: 'issue-1',
          },
        },
        id: 30,
      });

      expect(mockOrchestrator.handleAgentCompletion).toHaveBeenCalledWith({
        status: 'succeeded',
        agentId: 'agent-1',
        runId: 'run-1',
        issueId: 'issue-1',
      });
    });

    it('calls handleAgentCompletion on failed event', async () => {
      const mockOrchestrator = {
        handleAgentCompletion: vi.fn().mockResolvedValue(undefined),
        recordActivity: vi.fn(),
      };

      const handlerWithOrch = createRpcHandler(
        mockOrchestrator as unknown as Parameters<typeof createRpcHandler>[0],
      );

      await handlerWithOrch({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'failed',
            agentId: 'agent-2',
            runId: 'run-2',
            issueId: 'issue-2',
          },
        },
        id: 31,
      });

      expect(mockOrchestrator.handleAgentCompletion).toHaveBeenCalledWith({
        status: 'failed',
        agentId: 'agent-2',
        runId: 'run-2',
        issueId: 'issue-2',
      });
    });

    it('calls recordActivity on running event with issueId', async () => {
      const mockOrchestrator = {
        handleAgentCompletion: vi.fn().mockResolvedValue(undefined),
        recordActivity: vi.fn(),
      };

      const handlerWithOrch = createRpcHandler(
        mockOrchestrator as unknown as Parameters<typeof createRpcHandler>[0],
      );

      await handlerWithOrch({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'running',
            agentId: 'agent-1',
            runId: 'run-1',
            issueId: 'issue-1',
          },
        },
        id: 32,
      });

      expect(mockOrchestrator.recordActivity).toHaveBeenCalledWith('issue-1');
      expect(mockOrchestrator.handleAgentCompletion).not.toHaveBeenCalled();
    });
  });

  describe('onEvent without orchestrator', () => {
    it('returns received: true without errors', async () => {
      const handlerNoOrch = createRpcHandler();

      const response = await handlerNoOrch({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'heartbeat.run.status',
          data: {
            status: 'succeeded',
            agentId: 'agent-1',
            runId: 'run-1',
            issueId: 'issue-1',
          },
        },
        id: 33,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 33,
        result: { received: true, status: 'succeeded' },
      });
    });
  });

  describe('backward compatibility', () => {
    it('createRpcHandler() with no args still works', async () => {
      const handlerCompat = createRpcHandler();

      const response = await handlerCompat({
        jsonrpc: '2.0',
        method: 'health',
        id: 34,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 34,
      });
    });
  });

  describe('executeAction', () => {
    it('routes valid action to ACTION_HANDLERS and returns result', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: { action: 'gsd.status', args: {} },
        id: 40,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 40,
        result: { success: true, data: { status: 'running', phases: [] } },
      });
    });

    it('routes gsd.start with args to ACTION_HANDLERS', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: {
          action: 'gsd.start',
          args: { projectPath: '/p', brief: 'build it' },
        },
        id: 41,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 41,
        result: { success: true },
      });
      expect(mock.start).toHaveBeenCalledWith('/p', 'build it');
    });

    it('returns METHOD_NOT_FOUND for unknown action', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: { action: 'gsd.nonexistent', args: {} },
        id: 42,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 42,
        error: { code: -32601, message: expect.stringContaining('Unknown action') },
      });
    });

    it('returns INTERNAL_ERROR without orchestrator', async () => {
      const h = createRpcHandler();

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: { action: 'gsd.status', args: {} },
        id: 43,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 43,
        error: { code: -32603, message: expect.stringContaining('not initialized') },
      });
    });

    it('returns INVALID_PARAMS when action field is missing', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: { args: {} },
        id: 44,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 44,
        error: { code: -32602, message: expect.stringContaining('Missing action') },
      });
    });

    it('wraps handler error in ActionResult when handler throws', async () => {
      const mock = createMockRunner();
      mock.start.mockRejectedValue(new Error('spawn failed'));
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'executeAction',
        params: {
          action: 'gsd.start',
          args: { projectPath: '/p', brief: 'b' },
        },
        id: 45,
      });

      // The ACTION_HANDLER catches the error and returns { success: false, error: ... }
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 45,
        result: { success: false, error: 'spawn failed' },
      });
    });
  });

  describe('onEvent chat.message', () => {
    it('routes "status" command to gsd.status handler', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'status' } },
        id: 50,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 50,
        result: { received: true, reply: { success: true } },
      });
    });

    it('routes "start Build me an app" to gsd.start handler', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'chat.message',
          data: { content: 'start Build me an app' },
        },
        id: 51,
      });

      // Chat parser provides { brief: 'Build me an app' } but gsd.start
      // also requires projectPath, so schema validation returns an error.
      // The handler is still called, returning { success: false, error: ... }
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 51,
        result: { received: true, reply: { success: false } },
      });
    });

    it('routes "resolve ESC-<uuid> option 1" to gsd.override handler', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const escalationId = 'ESC-550e8400-e29b-41d4-a716-446655440000';

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: {
          type: 'chat.message',
          data: { content: `resolve ${escalationId} option 1` },
        },
        id: 52,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 52,
        result: { received: true, reply: { success: true } },
      });
      expect(mock.resolveEscalation).toHaveBeenCalledWith(
        escalationId,
        'option 1',
      );
    });

    it('returns help text for unrecognized message', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'hello' } },
        id: 53,
      });

      const result = (response as { result: { reply: { data: { message: string } } } })
        .result.reply.data.message;
      expect(result).toContain('Available commands');
      expect(result).toContain('start');
      expect(result).toContain('status');
    });

    it('returns not-initialized message without orchestrator', async () => {
      const h = createRpcHandler();

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'status' } },
        id: 54,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 54,
        result: { received: true, reply: expect.stringContaining('not initialized') },
      });
    });

    it('returns received:true for empty content', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: '' } },
        id: 55,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 55,
        result: { received: true },
      });
      // Should not have a reply field
      expect((response as { result: Record<string, unknown> }).result.reply).toBeUndefined();
    });

    it('routes "pause" command correctly', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'pause' } },
        id: 56,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 56,
        result: { received: true, reply: { success: true } },
      });
      expect(mock.pause).toHaveBeenCalled();
    });

    it('routes "resume" command correctly', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'resume' } },
        id: 57,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 57,
        result: { received: true, reply: { success: true } },
      });
      expect(mock.resume).toHaveBeenCalled();
    });

    it('routes "retry phase 3" command correctly', async () => {
      const mock = createMockRunner();
      const h = createRpcHandler(
        mock as unknown as Parameters<typeof createRpcHandler>[0],
      );

      const response = await h({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'chat.message', data: { content: 'retry phase 3' } },
        id: 58,
      });

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 58,
        result: { received: true, reply: { success: true } },
      });
      expect(mock.retryPhase).toHaveBeenCalledWith(3, undefined);
    });
  });

  describe('stub methods', () => {
    it('getState returns not_implemented', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'getState',
        id: 4,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'not_implemented' },
        id: 4,
      });
    });

    it('registerTools returns not_implemented', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'registerTools',
        id: 6,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'not_implemented' },
        id: 6,
      });
    });

    it('configure returns not_implemented', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'configure',
        id: 7,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'not_implemented' },
        id: 7,
      });
    });
  });

  describe('shutdown', () => {
    it('returns shutting_down status', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'shutdown',
        id: 8,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'shutting_down' },
        id: 8,
      });
    });
  });

  describe('error handling', () => {
    it('returns -32601 for unknown method', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'nonexistent',
        id: 9,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found' },
        id: 9,
      });
    });

    it('returns -32600 for invalid request (missing jsonrpc)', async () => {
      const response = await handler({
        method: 'health',
        id: 10,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: 10,
      });
    });

    it('returns -32600 for invalid request (wrong jsonrpc version)', async () => {
      const response = await handler({
        jsonrpc: '1.0',
        method: 'health',
        id: 11,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: 11,
      });
    });
  });

  describe('notifications', () => {
    it('returns undefined for notification (no id field)', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'issue.created' },
      });

      expect(response).toBeUndefined();
    });
  });
});
