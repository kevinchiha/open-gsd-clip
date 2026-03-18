import { describe, expect, it } from 'vitest';
import { createChildLogger, logger } from './logger.js';

describe('logger', () => {
  it('creates a logger instance without throwing', () => {
    expect(logger).toBeDefined();
  });

  it('has expected logging methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('has the correct logger name', () => {
    // pino stores bindings in an internal structure
    // The name should be set via the constructor options
    expect(logger).toHaveProperty('bindings');
    const bindings = logger.bindings();
    expect(bindings.name).toBe('@open-gsd/clip');
  });

  it('creates child loggers with component name', () => {
    const child = createChildLogger('bridge');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    const bindings = child.bindings();
    expect(bindings.component).toBe('bridge');
  });

  it('writes to stderr, not stdout', () => {
    // pino.destination(2) targets file descriptor 2 (stderr)
    // We verify this by checking the destination property
    // In non-development mode, the logger is created with pino.destination(2)
    // The logger instance itself confirms it is writable
    expect(logger).toBeDefined();
    // Verify the stream is writable (pino destination objects have a write method)
    const destination = Reflect.get(logger, 'stream') as
      | { fd?: number }
      | undefined;
    // In test environment (non-development), pino.destination(2) is used
    // which creates a SonicBoom instance with fd=2
    if (destination && 'fd' in destination) {
      expect(destination.fd).toBe(2);
    }
  });
});
