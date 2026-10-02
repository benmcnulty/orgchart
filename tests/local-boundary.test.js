import { afterAll, expect, test } from 'bun:test';
import * as app from '../server.js';

const origin = 'http://127.0.0.1:3000';
test('blocks foreign Host/Origin and cross-site requests before routing', async () => {
  for (const headers of [{ Host: 'attacker.example' }, { Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await app.appFetch(new Request(origin, { headers }));
    expect(response.status).toBe(403);
  }
});

test('blocks cross-site inference requests before parsing or contacting upstream', async () => {
  const request = new Request(origin + '/api/stream?url=http://127.0.0.1:1/api/chat', {
    method: 'POST', headers: { Origin: 'https://attacker.example' }, body: '{}'
  });
  expect((await app.appFetch(request)).status).toBe(403);
});

test('rejects non-loopback URL authorities and unexpected local ports', async () => {
  for (const url of ['http://attacker.example:3000/', 'http://127.0.0.1:3001/']) {
    expect((await app.appFetch(new Request(url))).status).toBe(403);
  }
});

test('permits same-origin local viewing and native no-Origin requests', async () => {
  expect((await app.appFetch(new Request(origin))).status).toBe(200);
  expect((await app.appFetch(new Request(origin, { headers: { Origin: origin } }))).status).toBe(200);
});

let server;
afterAll(() => server?.stop(true));
test('actual Bun listener is loopback-only and enforces the same boundary', async () => {
  server = app.startServer(0);
  const local = `http://127.0.0.1:${server.port}`;
  expect(server.hostname).toBe('127.0.0.1');
  expect((await fetch(local)).status).toBe(200);
  expect((await fetch(local, { headers: { Host: 'attacker.example' } })).status).toBe(403);
  expect((await fetch(local, { headers: { Origin: 'null' } })).status).toBe(403);
});
