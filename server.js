import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = join(import.meta.dir, 'public');
let nextRequestSeq = 1;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Proxy an Ollama API call through the server to avoid CORS issues with LAN sources.
// Only GET is needed for the initial phase (model listing / health checks).
export function validateProxyTarget(rawUrl) {
  if (!rawUrl) return { error: 'Missing url parameter' };
  try {
    const target = new URL(rawUrl);
    if (!['http:', 'https:'].includes(target.protocol)) {
      return { error: 'Only http and https targets are allowed' };
    }
    return { targetUrl: target.toString() };
  } catch {
    return { error: 'Invalid target URL' };
  }
}

export function validateStreamPayload(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  if (!body.model || typeof body.model !== 'string') return { error: 'Missing model in request body' };
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { error: 'Missing messages in request body' };
  return { ok: true };
}

function logStreamEvent(id, stage, meta = {}) {
  const detail = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ')}`)
    .join(' ');
  console.log(`[stream ${id}] ${stage}${detail ? ` ${detail}` : ''}`);
}

async function handleProxy(url) {
  const validation = validateProxyTarget(url.searchParams.get('url'));
  if (validation.error) {
    return json({ error: validation.error }, 400);
  }
  const { targetUrl } = validation;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    const data = await response.json();
    return json(data, response.status);
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Connection timed out' : err.message;
    return json({ error: message }, 502);
  }
}

// Streaming proxy for Ollama chat completions.
// Pipes the upstream NDJSON body directly without buffering so the client
// sees tokens as they arrive.
async function handleStream(req, url) {
  const validation = validateProxyTarget(url.searchParams.get('url'));
  if (validation.error) return json({ error: validation.error }, 400);
  const { targetUrl } = validation;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const payloadValidation = validateStreamPayload(body);
  if (payloadValidation.error) return json({ error: payloadValidation.error }, 400);

  const requestId = nextRequestSeq++;
  const startedAt = Date.now();
  logStreamEvent(requestId, 'start', { target: targetUrl, model: body.model, messages: body.messages.length });

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      logStreamEvent(requestId, 'upstream_error', { status: upstream.status, duration_ms: Date.now() - startedAt });
      return json({ error: text }, upstream.status);
    }

    // Pipe the readable stream directly — no buffering.
    const response = new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
    });
    logStreamEvent(requestId, 'streaming', { duration_ms: Date.now() - startedAt });
    return response;
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Connection timed out' : err.message;
    logStreamEvent(requestId, 'failed', { error: message, duration_ms: Date.now() - startedAt });
    return json({ error: message }, 502);
  }
}

// Serve a static file from the public directory.
function handleStatic(pathname) {
  const filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);

  return new Response(content, { headers: { 'Content-Type': contentType } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function appFetch(req) {
  const url = new URL(req.url);

  if (url.pathname === '/api/proxy') {
    return handleProxy(url);
  }

  if (url.pathname === '/api/stream' && req.method === 'POST') {
    return handleStream(req, url);
  }

  return handleStatic(url.pathname);
}

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    fetch: appFetch,
  });

  console.log(`\n  Distributed Inference Dashboard`);
  console.log(`  → http://localhost:${server.port}\n`);
}
