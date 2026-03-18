import pino from 'pino';

/**
 * Application logger configured to write to stderr (fd 2).
 *
 * CRITICAL: stdout is reserved for JSON-RPC protocol communication
 * with the Paperclip host. All logging MUST go to stderr.
 */
export const logger = pino(
  {
    name: '@open-gsd/clip',
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { destination: 2 } }
        : undefined,
  },
  process.env.NODE_ENV !== 'development' ? pino.destination(2) : undefined,
);

/**
 * Create a child logger with a component-specific name.
 * Inherits stderr destination from the parent logger.
 */
export function createChildLogger(name: string): pino.Logger {
  return logger.child({ component: name });
}
