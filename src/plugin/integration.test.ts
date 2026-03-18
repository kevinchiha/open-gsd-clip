import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PLUGIN_PATH = join(import.meta.dirname, 'index.ts');

/**
 * Send a JSON-RPC request to the plugin via stdin and read the response from stdout.
 */
function sendRequest(
  child: ReturnType<typeof spawn>,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Response timeout after 5s')),
      5000,
    );

    const onData = (data: Buffer) => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      try {
        const response = JSON.parse(data.toString().trim().split('\n')[0]);
        resolve(response);
      } catch {
        reject(new Error(`Failed to parse response: ${data.toString()}`));
      }
    };

    child.stdout?.on('data', onData);
    child.stdin?.write(`${JSON.stringify(request)}\n`);
  });
}

function spawnPlugin() {
  return spawn('node', ['--import', 'tsx', PLUGIN_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LOG_LEVEL: 'silent' },
  });
}

describe('plugin integration (child process)', () => {
  it('responds to initialize with manifest', async () => {
    const child = spawnPlugin();
    try {
      const response = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toMatchObject({
        id: '@open-gsd/clip',
        apiVersion: 1,
        version: expect.any(String),
        displayName: expect.any(String),
        capabilities: expect.any(Array),
      });
    } finally {
      child.stdin?.end();
      child.kill();
    }
  }, 10000);

  it('responds to health with ok status', async () => {
    const child = spawnPlugin();
    try {
      const response = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'health',
        id: 2,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 2,
      });
    } finally {
      child.stdin?.end();
      child.kill();
    }
  }, 10000);

  it('responds to unknown method with -32601 error', async () => {
    const child = spawnPlugin();
    try {
      const response = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'nonexistent',
        id: 3,
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found' },
        id: 3,
      });
    } finally {
      child.stdin?.end();
      child.kill();
    }
  }, 10000);

  it('handles multiple sequential requests on same process', async () => {
    const child = spawnPlugin();
    try {
      const r1 = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
      });
      expect((r1.result as { id: string }).id).toBe('@open-gsd/clip');

      const r2 = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'health',
        id: 2,
      });
      expect((r2.result as { status: string }).status).toBe('ok');

      const r3 = await sendRequest(child, {
        jsonrpc: '2.0',
        method: 'onEvent',
        params: { type: 'issue.created' },
        id: 3,
      });
      expect((r3.result as { received: boolean }).received).toBe(true);
    } finally {
      child.stdin?.end();
      child.kill();
    }
  }, 10000);

  it('exits cleanly when stdin closes', async () => {
    const child = spawnPlugin();

    // Send a request to ensure the plugin is running
    await sendRequest(child, {
      jsonrpc: '2.0',
      method: 'health',
      id: 1,
    });

    // Close stdin
    child.stdin?.end();

    // Wait for the process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000);

      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
  }, 10000);
});
