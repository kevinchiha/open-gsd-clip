import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { createChildLogger } from '../shared/logger.js';
import { RPC_ERRORS } from './types.js';

const log = createChildLogger('rpc-transport');

/**
 * Creates a line-delimited JSON transport over stdin/stdout.
 *
 * Each line read from `input` is parsed as JSON, passed to the message handler,
 * and the handler's response (if any) is written as JSON + newline to `output`.
 *
 * Malformed JSON lines produce a JSON-RPC parse error response.
 * Empty lines are silently skipped.
 */
export function createTransport(input: Readable, output: Writable) {
  const rl = createInterface({ input, crlfDelay: Infinity });

  return {
    onMessage(handler: (msg: unknown) => Promise<unknown>) {
      rl.on('line', async (line) => {
        if (!line.trim()) return;

        let request: unknown;
        try {
          request = JSON.parse(line);
        } catch {
          log.warn('Received malformed JSON');
          output.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              error: { code: RPC_ERRORS.PARSE_ERROR, message: 'Parse error' },
              id: null,
            })}\n`,
          );
          return;
        }

        try {
          const response = await handler(request);
          if (response !== undefined) {
            output.write(`${JSON.stringify(response)}\n`);
          }
        } catch (err) {
          log.error({ err }, 'Handler threw unexpected error');
          output.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: RPC_ERRORS.INTERNAL_ERROR,
                message: 'Internal error',
              },
              id: null,
            })}\n`,
          );
        }
      });
    },

    close() {
      rl.close();
    },
  };
}
