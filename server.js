import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { runPipeline } from './lib/pipeline-runner.js';
import {
  bootstrapOrgChart,
  deleteAgent,
  deleteSkill,
  ensureOrgChartStore,
  buildWikipediaPageUrl,
  extractReadableText,
  listTools,
  memoryDelete,
  memoryIndex,
  memoryRead,
  memoryWrite,
  normalizeDuckDuckGoHtml,
  normalizeWikipediaExtract,
  listIntranet,
  listCustomTools,
  writeAgent,
  writeCustomTool,
  writeIntranetDoc,
  writeRecord,
  writeSkill,
  writeTool,
  runCustomTool,
} from './lib/orgchart-store.js';

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

async function readJsonRequest(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function badRequest(message) {
  return json({ error: message }, 400);
}

async function handleOrgChartBootstrap() {
  await ensureOrgChartStore();
  return json(await bootstrapOrgChart());
}

async function handleAgentUpsert(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid agent payload');
  return json({ agent: await writeAgent(body) });
}

async function handleAgentDelete(slug) {
  if (!slug) return badRequest('Missing agent slug');
  await deleteAgent(slug);
  return json({ ok: true });
}

async function handleSkillUpsert(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid skill payload');
  return json({ skill: await writeSkill(body) });
}

async function handleSkillDelete(slug) {
  if (!slug) return badRequest('Missing skill slug');
  await deleteSkill(slug);
  return json({ ok: true });
}

async function handleToolUpsert(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid tool payload');
  return json({ tool: await writeTool(body) });
}

async function handleToolsList() {
  return json({ tools: await listTools() });
}

async function handleIntranetList() {
  return json({ intranet: await listIntranet() });
}

async function handleIntranetDocUpsert(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid intranet document payload');
  const section = typeof body.section === 'string' ? body.section.trim() : '';
  if (!section) return badRequest('section is required');
  try {
    return json({ doc: await writeIntranetDoc(section, body) });
  } catch (err) {
    return json({ error: err.message }, 400);
  }
}

async function handleRecordWrite(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid record payload');
  return json({ record: await writeRecord(body) });
}

async function handleCustomToolsList() {
  return json({ customTools: await listCustomTools() });
}

async function handleCustomToolUpsert(req) {
  const body = await readJsonRequest(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid custom tool payload');
  return json({ customTool: await writeCustomTool(body) });
}

async function handleCustomToolExecute(req) {
  const body = await readJsonRequest(req);
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return badRequest('slug is required');
  const mode = typeof body?.mode === 'string' ? body.mode.trim() : 'run';
  try {
    return json(await runCustomTool(slug, body?.input ?? '', mode));
  } catch (err) {
    return json({ error: err.message }, 400);
  }
}

async function handleLocalAgentMigration(req) {
  const body = await readJsonRequest(req);
  if (!body || !Array.isArray(body.agents)) return badRequest('agents array is required');
  const migrated = [];
  for (const agent of body.agents) {
    migrated.push(await writeAgent(agent));
  }
  return json({ agents: migrated });
}

async function handleToolSearch(req) {
  const body = await readJsonRequest(req);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return badRequest('query is required');

  const url = new URL('https://duckduckgo.com/html/');
  url.searchParams.set('q', query);
  url.searchParams.set('kl', typeof body?.region === 'string' ? body.region : 'us-en');

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'OrgChart/1.0 (+local Bun server)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!upstream.ok) {
    return json({ error: `Search failed with HTTP ${upstream.status}` }, 502);
  }

  const html = await upstream.text();
  return json({ query, results: normalizeDuckDuckGoHtml(html) });
}

async function handleToolScrape(req) {
  const body = await readJsonRequest(req);
  const target = typeof body?.url === 'string' ? body.url.trim() : '';
  const validation = validateProxyTarget(target);
  if (validation.error) return badRequest(validation.error);
  const maxChars = Math.max(1000, Math.min(Number(body?.maxChars) || 12000, 50000));

  const upstream = await fetch(validation.targetUrl, {
    headers: { 'User-Agent': 'OrgChart/1.0 (+local Bun server)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!upstream.ok) {
    return json({ error: `Scrape failed with HTTP ${upstream.status}` }, 502);
  }
  const html = await upstream.text();
  return json({
    url: validation.targetUrl,
    content: extractReadableText(html, maxChars),
  });
}

async function handleToolWikipedia(req) {
  const body = await readJsonRequest(req);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const explicitTitle = typeof body?.title === 'string' ? body.title.trim() : '';
  const language = typeof body?.language === 'string' && /^[a-z-]{2,12}$/i.test(body.language) ? body.language.trim().toLowerCase() : 'en';
  const maxChars = Math.max(1000, Math.min(Number(body?.maxChars) || 8000, 30000));
  if (!query && !explicitTitle) return badRequest('query or title is required');

  let title = explicitTitle;
  let searchResults = [];

  if (!title) {
    const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', query);
    searchUrl.searchParams.set('srlimit', '5');
    searchUrl.searchParams.set('utf8', '1');
    searchUrl.searchParams.set('origin', '*');

    const searchResponse = await fetch(searchUrl, {
      headers: { 'User-Agent': 'OrgChart/1.0 (+local Bun server)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!searchResponse.ok) {
      return json({ error: `Wikipedia search failed with HTTP ${searchResponse.status}` }, 502);
    }
    const searchJson = await searchResponse.json();
    searchResults = (searchJson?.query?.search ?? []).map(result => ({
      title: result.title,
      snippet: String(result.snippet ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      pageId: result.pageid,
    }));
    title = searchResults[0]?.title ?? '';
    if (!title) return json({ error: `No Wikipedia results found for "${query}"` }, 404);
  }

  const pageUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  pageUrl.searchParams.set('action', 'query');
  pageUrl.searchParams.set('format', 'json');
  pageUrl.searchParams.set('prop', 'extracts|info');
  pageUrl.searchParams.set('inprop', 'url');
  pageUrl.searchParams.set('redirects', '1');
  pageUrl.searchParams.set('explaintext', '1');
  pageUrl.searchParams.set('exintro', body?.fullText ? '0' : '1');
  pageUrl.searchParams.set('titles', title);
  pageUrl.searchParams.set('origin', '*');

  const pageResponse = await fetch(pageUrl, {
    headers: { 'User-Agent': 'OrgChart/1.0 (+local Bun server)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!pageResponse.ok) {
    return json({ error: `Wikipedia page fetch failed with HTTP ${pageResponse.status}` }, 502);
  }
  const pageJson = await pageResponse.json();
  const pages = Object.values(pageJson?.query?.pages ?? {});
  const page = pages.find(candidate => candidate && !candidate.missing);
  if (!page) {
    return json({ error: `No Wikipedia page resolved for "${title}"` }, 404);
  }

  const extract = normalizeWikipediaExtract(page.extract ?? '', maxChars);
  return json({
    query: query || title,
    title: page.title,
    url: page.fullurl || buildWikipediaPageUrl(page.title, language),
    summary: normalizeWikipediaExtract(page.extract ?? '', Math.min(1200, maxChars)),
    content: extract,
    searchResults,
  });
}

async function handleMemoryTool(req) {
  const body = await readJsonRequest(req);
  const op = typeof body?.op === 'string' ? body.op.trim() : '';
  const agentSlug = typeof body?.agentSlug === 'string' ? body.agentSlug.trim() : '';
  const scope = typeof body?.scope === 'string' ? body.scope.trim() : '';
  const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
  if (!agentSlug || !scope) return badRequest('agentSlug and scope are required');

  if (op === 'index') return json(await memoryIndex(agentSlug, scope));
  if (!fileName && op !== 'index') return badRequest('fileName is required');
  if (op === 'read') return json(await memoryRead(agentSlug, scope, fileName));
  if (op === 'write' || op === 'update') return json(await memoryWrite(agentSlug, scope, fileName, body?.content ?? ''));
  if (op === 'delete') return json(await memoryDelete(agentSlug, scope, fileName));
  return badRequest('Unsupported memory operation');
}

// ─── Pipeline SSE Endpoint ───────────────────────────────────────────────────
// POST /api/pipeline/run
//
// Accepts { userInput, phaseOverrides?, phaseDefinitions? } and streams pipeline progress back as
// Server-Sent Events. Each event is a JSON-encoded object on a `data:` line.
//
// SSE event types: primer | phase_start | chunk | phase_retry | phase_complete | pipeline_complete | error
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
  const phaseDefinitions = Array.isArray(body.phaseDefinitions) ? body.phaseDefinitions : [];
  const precomputedCtx = body.precomputedCtx ?? {};
  const requestId = nextRequestSeq++;
  console.log(`[pipeline ${requestId}] start input_len=${userInput.length}`);

  // Build a ReadableStream that emits SSE events as the pipeline progresses
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': keepalive\n\n'));
        } catch { /* client disconnected */ }
      }, 5000);

      const send = event => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        await runPipeline(userInput, phaseOverrides, send, precomputedCtx, phaseDefinitions);
        console.log(`[pipeline ${requestId}] complete`);
      } catch (err) {
        console.error(`[pipeline ${requestId}] fatal`, err.message);
        send({ type: 'error', phase: null, message: err.message });
      } finally {
        clearInterval(keepAliveTimer);
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

  if (url.pathname === '/api/orgchart/bootstrap' && req.method === 'GET') {
    return handleOrgChartBootstrap();
  }

  if (url.pathname === '/api/orgchart/agents' && req.method === 'POST') {
    return handleAgentUpsert(req);
  }

  if (url.pathname.startsWith('/api/orgchart/agents/') && req.method === 'DELETE') {
    return handleAgentDelete(url.pathname.split('/').pop());
  }

  if (url.pathname === '/api/orgchart/skills' && req.method === 'POST') {
    return handleSkillUpsert(req);
  }

  if (url.pathname.startsWith('/api/orgchart/skills/') && req.method === 'DELETE') {
    return handleSkillDelete(url.pathname.split('/').pop());
  }

  if (url.pathname === '/api/orgchart/tools' && req.method === 'GET') {
    return handleToolsList();
  }

  if (url.pathname === '/api/orgchart/tools' && req.method === 'POST') {
    return handleToolUpsert(req);
  }

  if (url.pathname === '/api/orgchart/intranet' && req.method === 'GET') {
    return handleIntranetList();
  }

  if (url.pathname === '/api/orgchart/intranet' && req.method === 'POST') {
    return handleIntranetDocUpsert(req);
  }

  if (url.pathname === '/api/orgchart/intranet/records' && req.method === 'POST') {
    return handleRecordWrite(req);
  }

  if (url.pathname === '/api/orgchart/custom-tools' && req.method === 'GET') {
    return handleCustomToolsList();
  }

  if (url.pathname === '/api/orgchart/custom-tools' && req.method === 'POST') {
    return handleCustomToolUpsert(req);
  }

  if (url.pathname === '/api/orgchart/custom-tools/execute' && req.method === 'POST') {
    return handleCustomToolExecute(req);
  }

  if (url.pathname === '/api/orgchart/migrate-agents' && req.method === 'POST') {
    return handleLocalAgentMigration(req);
  }

  if (url.pathname === '/api/tools/web-search' && req.method === 'POST') {
    return handleToolSearch(req);
  }

  if (url.pathname === '/api/tools/web-scrape' && req.method === 'POST') {
    return handleToolScrape(req);
  }

  if (url.pathname === '/api/tools/wikipedia' && req.method === 'POST') {
    return handleToolWikipedia(req);
  }

  if (url.pathname === '/api/tools/memory' && req.method === 'POST') {
    return handleMemoryTool(req);
  }

  return handleStatic(url.pathname);
}

if (import.meta.main) {
  await ensureOrgChartStore();
  const server = Bun.serve({
    port: PORT,
    idleTimeout: 255,
    fetch: appFetch,
  });

  console.log(`\n  OrgChart: Paper Dolls for Corporate Theater`);
  console.log(`  → http://localhost:${server.port}\n`);
}
