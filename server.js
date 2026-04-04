import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { runPipeline } from './lib/pipeline-runner.js';

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

// ─── Pipeline SSE Endpoint ───────────────────────────────────────────────────
// POST /api/pipeline/run
//
// Accepts { userInput, phaseOverrides? } and streams pipeline progress back as
// Server-Sent Events. Each event is a JSON-encoded object on a `data:` line.
//
// SSE event types: phase_start | chunk | phase_complete | pipeline_complete | error
// See lib/pipeline-runner.js for the full event schema.

async function handlePipelineRun(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const userInput = typeof body.userInput === 'string' ? body.userInput.trim() : '';
  if (!userInput) return json({ error: 'userInput is required' }, 400);

  const phaseOverrides = body.phaseOverrides ?? {};
  const precomputedCtx = body.precomputedCtx ?? {};
  const requestId = nextRequestSeq++;
  console.log(`[pipeline ${requestId}] start input_len=${userInput.length}`);

  // Build a ReadableStream that emits SSE events as the pipeline progresses
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = event => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        await runPipeline(userInput, phaseOverrides, send, precomputedCtx);
        console.log(`[pipeline ${requestId}] complete`);
      } catch (err) {
        console.error(`[pipeline ${requestId}] fatal`, err.message);
        send({ type: 'error', phase: null, message: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
    },
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

  if (url.pathname === '/api/pipeline/run' && req.method === 'POST') {
    return handlePipelineRun(req);
  }

  return handleStatic(url.pathname);
}

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    fetch: appFetch,
  });

  console.log(`\n  OrgChart: Paper Dolls for Corporate Theater`);
  console.log(`  → http://localhost:${server.port}\n`);
}
