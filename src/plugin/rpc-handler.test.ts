import { describe, expect, it } from 'vitest';
import { createRpcHandler } from './rpc-handler.js';

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
    it('returns received: true', async () => {
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

    it('executeAction returns not_implemented', async () => {
      const response = await handler({
        jsonrpc: '2.0',
        method: 'executeAction',
        id: 5,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'not_implemented' },
        id: 5,
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
