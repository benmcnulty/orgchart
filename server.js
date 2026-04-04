import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = join(import.meta.dir, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Proxy an Ollama API call through the server to avoid CORS issues with LAN sources.
// Only GET is needed for the initial phase (model listing / health checks).
async function handleProxy(url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return json({ error: 'Missing url parameter' }, 400);
  }

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
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return json({ error: 'Missing url parameter' }, 400);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      return json({ error: text }, upstream.status);
    }

    // Pipe the readable stream directly — no buffering.
    return new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Connection timed out' : err.message;
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

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/api/proxy') {
      return handleProxy(url);
    }

    if (url.pathname === '/api/stream' && req.method === 'POST') {
      return handleStream(req, url);
    }

    return handleStatic(url.pathname);
  },
});

console.log(`\n  Distributed Inference Dashboard`);
console.log(`  → http://localhost:${server.port}\n`);
