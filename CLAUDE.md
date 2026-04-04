# Distributed Inference Dashboard — CLAUDE.md

## Project Overview

Local web dashboard for managing Ollama API inference sources across a network. Acts as the configuration/monitoring layer for an agentic system that routes inference to locally-networked LLM backends.

## Architecture

| File | Role |
|---|---|
| `server.js` | Bun HTTP server. Serves `public/` and proxies Ollama API calls via `/api/proxy?url=<target>` |
| `public/index.html` | Application shell — no framework, no build step |
| `public/style.css` | Dark theme using CSS custom properties; no preprocessor |
| `public/app.js` | All frontend logic: state, rendering, API calls, localStorage persistence |

## Key Design Decisions

### Server-side proxy for CORS
All Ollama API calls from the browser go through `GET /api/proxy?url=<target>`. This avoids CORS failures when the dashboard connects to remote Ollama servers on the LAN. The proxy uses `AbortSignal.timeout(8000)` — adjust if LAN latency is higher.

### DOM methods over innerHTML
`app.js` uses `createElement` + `textContent` throughout card rendering. Never use `innerHTML` with user-supplied strings (URLs, model names, error messages) — this is a security boundary, not style preference.

### Source state shape
```js
{
  id: string,          // 'source-N' — stable across sessions
  url: string,         // normalized, no trailing slash
  status: 'connecting' | 'connected' | 'error',
  models: string[],    // sorted; populated on connect
  selectedModel: string,
  error: string|null,
  _seq: number,        // used to derive next ID after reload
}
```
Only `id`, `url`, `selectedModel`, and `_seq` are persisted to localStorage. `status`, `models`, and `error` are always reset to initial values on load (they're runtime state).

### Default model
`DEFAULT_MODEL = 'gemma4:latest'` is applied when a source connects. If not available, falls back to the first model in the sorted list from `/api/tags`.

## Development Commands

```bash
bun run dev    # --watch hot reload
bun run start  # production
```

Server listens on port 3000 (override with `PORT=<n>`).

## Ollama API Surface Used

| Endpoint | Purpose |
|---|---|
| `GET /api/tags` | List available models + verify connectivity |

Future endpoints (inference routing, status) should also be proxied through `/api/proxy`.

## What to Build Next

- Inference routing layer: select which source handles a given request
- Load balancing / failover between sources
- Per-source latency / health monitoring
- Model capability tagging (context length, vision support, etc.)
