import { describe, expect, it } from 'vitest';
import { parseCommand } from './chat-parser.js';

describe('parseCommand', () => {
  describe('start command', () => {
    it('parses "start Build me a todo app"', () => {
      const result = parseCommand('start Build me a todo app');
      expect(result).toEqual({
        action: 'gsd.start',
        params: { brief: 'Build me a todo app' },
      });
    });

    it('parses "build a REST API"', () => {
      const result = parseCommand('build a REST API');
      expect(result).toEqual({
        action: 'gsd.start',
        params: { brief: 'a REST API' },
      });
    });

    it('parses "create a dashboard"', () => {
      const result = parseCommand('create a dashboard');
      expect(result).toEqual({
        action: 'gsd.start',
        params: { brief: 'a dashboard' },
      });
    });
  });

  describe('status command', () => {
    it('parses "status"', () => {
      const result = parseCommand('status');
      expect(result).toEqual({ action: 'gsd.status', params: {} });
    });

    it('parses "progress"', () => {
      const result = parseCommand('progress');
      expect(result).toEqual({ action: 'gsd.status', params: {} });
    });

    it('parses "how\'s it going"', () => {
      const result = parseCommand("how's it going");
      expect(result).toEqual({ action: 'gsd.status', params: {} });
    });

    it('parses "hows it going"', () => {
      const result = parseCommand('hows it going');
      expect(result).toEqual({ action: 'gsd.status', params: {} });
    });
  });

  describe('retry command', () => {
    it('parses "retry phase 3"', () => {
      const result = parseCommand('retry phase 3');
      expect(result).toEqual({
        action: 'gsd.retry',
        params: { phaseNumber: 3 },
      });
    });

    it('parses "retry 3"', () => {
      const result = parseCommand('retry 3');
      expect(result).toEqual({
        action: 'gsd.retry',
        params: { phaseNumber: 3 },
      });
    });
  });

  describe('pause command', () => {
    it('parses "pause"', () => {
      const result = parseCommand('pause');
      expect(result).toEqual({ action: 'gsd.pause', params: {} });
    });
  });

  describe('resume command', () => {
    it('parses "resume"', () => {
      const result = parseCommand('resume');
      expect(result).toEqual({ action: 'gsd.resume', params: {} });
    });
  });

  describe('override/resolve command', () => {
    it('parses "resolve ESC-abc123 option 2"', () => {
      const result = parseCommand('resolve ESC-abc123 option 2');
      expect(result).toEqual({
        action: 'gsd.override',
        params: { escalationId: 'ESC-abc123', decision: 'option 2' },
      });
    });
  });

  describe('unrecognized input', () => {
    it('returns null for "hello world"', () => {
      const result = parseCommand('hello world');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parseCommand('');
      expect(result).toBeNull();
    });
  });
});
