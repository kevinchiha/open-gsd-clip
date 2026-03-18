import { createChildLogger } from '../shared/logger.js';
import { createRpcHandler, manifest } from './rpc-handler.js';
import { createTransport } from './rpc-transport.js';

const log = createChildLogger('plugin');

export { manifest };

/**
 * Start the plugin worker.
 *
 * Creates a JSON-RPC transport over stdin/stdout, wires it to the RPC handler,
 * and begins listening for requests.
 *
 * @returns A cleanup function that closes the transport.
 */
export function startPlugin() {
  const transport = createTransport(process.stdin, process.stdout);
  const handler = createRpcHandler();

  transport.onMessage(handler);
  log.info('Plugin started, listening on stdin');

  // Clean exit when stdin closes (host disconnected)
  process.stdin.on('end', () => {
    log.info('stdin closed, shutting down');
    transport.close();
    process.exit(0);
  });

  return () => {
    transport.close();
  };
}

// Auto-start when run directly
// In ESM, we detect if this module is the entry point by checking if
// process.argv[1] resolves to this file (tsx rewrites the path)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('/plugin/index.ts') ||
  process.argv[1].endsWith('/plugin/index.js')
);

if (isMainModule) {
  startPlugin();
}
