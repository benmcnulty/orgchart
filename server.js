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

    return handleStatic(url.pathname);
  },
});

console.log(`\n  Distributed Inference Dashboard`);
console.log(`  → http://localhost:${server.port}\n`);
