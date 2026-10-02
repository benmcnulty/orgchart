import { expect, spyOn, test } from 'bun:test';
import { appFetch } from '../server.js';

const target = 'http://fake-user:fake-password@example.invalid/api/chat?token=fake-query';
function request() {
  return new Request('http://127.0.0.1:3000/api/stream?url=' + encodeURIComponent(target), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'example', messages: [{ role: 'user', content: 'test' }] })
  });
}

test('stream diagnostics redact target userinfo/path/query while preserving routing', async () => {
  const logs = [];
  const log = spyOn(console, 'log').mockImplementation(value => logs.push(String(value)));
  let received;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async url => {
    received = url;
    return new Response('{"done":true}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  });
  try {
    const result = await appFetch(request());
    expect(result.status).toBe(200);
    await result.text();
    expect(received).toBe(target);
    const text = logs.join('\n');
    expect(text).toContain('target=http://example.invalid');
    for (const value of ['fake-user', 'fake-password', 'fake-query', '/api/chat', 'token=']) expect(text).not.toContain(value);
  } finally { fetch.mockRestore(); log.mockRestore(); }
});

test('upstream exceptions never echo URL credentials or provider headers to diagnostics/errors', async () => {
  const logs = [];
  const log = spyOn(console, 'log').mockImplementation(value => logs.push(String(value)));
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new TypeError(`Cannot construct ${target}; Authorization: Bearer fake-header`);
  });
  try {
    const result = await appFetch(request());
    expect(result.status).toBe(502);
    const text = logs.join('\n') + await result.text();
    for (const value of ['fake-user', 'fake-password', 'fake-query', 'fake-header', 'Authorization']) expect(text).not.toContain(value);
    expect(logs.join('\n')).toContain('error=TypeError');
  } finally { fetch.mockRestore(); log.mockRestore(); }
});
