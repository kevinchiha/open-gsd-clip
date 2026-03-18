import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createTransport } from './rpc-transport.js';

describe('rpc-transport', () => {
  it('calls handler with parsed JSON and writes response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handler = vi
      .fn()
      .mockResolvedValue({ jsonrpc: '2.0', result: 'ok', id: 1 });

    const transport = createTransport(input, output);
    transport.onMessage(handler);

    input.write('{"jsonrpc":"2.0","method":"health","id":1}\n');

    // Wait for readline to process the line
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'health',
      id: 1,
    });

    // Read from output
    const chunk = output.read();
    expect(chunk).not.toBeNull();
    const response = JSON.parse(chunk.toString().trim());
    expect(response).toEqual({ jsonrpc: '2.0', result: 'ok', id: 1 });

    transport.close();
  });

  it('writes parse error response for malformed JSON', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handler = vi.fn();

    const transport = createTransport(input, output);
    transport.onMessage(handler);

    input.write('not valid json\n');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).not.toHaveBeenCalled();

    const chunk = output.read();
    expect(chunk).not.toBeNull();
    const response = JSON.parse(chunk.toString().trim());
    expect(response).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });

    transport.close();
  });

  it('skips empty lines without calling handler or writing response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handler = vi.fn();

    const transport = createTransport(input, output);
    transport.onMessage(handler);

    input.write('\n');
    input.write('   \n');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).not.toHaveBeenCalled();
    expect(output.read()).toBeNull();

    transport.close();
  });

  it('processes multiple lines independently', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let callCount = 0;
    const handler = vi.fn().mockImplementation(async (msg: unknown) => {
      callCount++;
      return {
        jsonrpc: '2.0',
        result: `response-${callCount}`,
        id: (msg as { id: number }).id,
      };
    });

    const transport = createTransport(input, output);
    transport.onMessage(handler);

    input.write('{"jsonrpc":"2.0","method":"a","id":1}\n');
    input.write('{"jsonrpc":"2.0","method":"b","id":2}\n');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(handler).toHaveBeenCalledTimes(2);

    // Read all output
    const allOutput = output.read()?.toString() ?? '';
    const lines = allOutput.trim().split('\n');
    expect(lines).toHaveLength(2);

    const resp1 = JSON.parse(lines[0]);
    const resp2 = JSON.parse(lines[1]);
    expect(resp1.id).toBe(1);
    expect(resp2.id).toBe(2);

    transport.close();
  });

  it('does not write response when handler returns undefined', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handler = vi.fn().mockResolvedValue(undefined);

    const transport = createTransport(input, output);
    transport.onMessage(handler);

    input.write('{"jsonrpc":"2.0","method":"notify"}\n');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalled();
    expect(output.read()).toBeNull();

    transport.close();
  });
});
