import { describe, expect, test } from 'bun:test';
import { validateProxyTarget, validateStreamPayload } from '../server.js';

describe('server validation helpers', () => {
  test('validates proxy target URLs', () => {
    expect(validateProxyTarget('http://localhost:11434/api/chat').targetUrl).toBe('http://localhost:11434/api/chat');
    expect(validateProxyTarget('file:///tmp/x').error).toBeTruthy();
    expect(validateProxyTarget('not a url').error).toBeTruthy();
  });

  test('validates stream payload basics', () => {
    expect(validateStreamPayload({ model: 'gemma4:latest', messages: [{ role: 'user', content: 'hi' }] }).ok).toBe(true);
    expect(validateStreamPayload({ model: '', messages: [] }).error).toContain('Missing model');
    expect(validateStreamPayload(null).error).toContain('Invalid request body');
  });
});
