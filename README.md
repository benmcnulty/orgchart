# Distributed Inference Dashboard

A local web application for managing and monitoring Ollama API inference sources across a network. It now includes a shared Gemma/Ollama prompt policy layer, multi-chat and meeting orchestration, draft-board collaboration, and structured observability for reasoning-heavy workflows.

## Features

- **Localhost default** — connects to `http://localhost:11434` on startup
- **Multi-source** — add any number of Ollama API servers on your LAN
- **Live model listing** — fetches available models from each source on connect
- **Smart defaults** — auto-selects `gemma4:latest` where available
- **Persistent** — source configuration survives page reloads (localStorage)
- **CORS-safe** — all Ollama API calls are proxied through the Bun server
- **Gemma-aware prompting** — XML-delimited prompts, hidden reasoning traces, and model-tier detection for Gemma-family models
- **Meeting orchestration** — facilitator planning, participant turns, attachment indexing, draft boards, and compact meeting memory
- **Observability** — streaming token flow, queued task inspection, and import/export session snapshots

## Quick Start

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Adding Sources

Click the **+** button and enter the base URL of an Ollama server on your network, e.g. `http://192.168.1.42:11434`. The dashboard will connect, verify reachability, and populate the model list from the `/api/tags` endpoint.

## Architecture

```
browser  ──GET /api/proxy?url=<ollama-url>──►  Bun server  ──►  Ollama API
         ◄──────────────────────────────────────────────────────────────────
```

The server-side proxy avoids CORS issues when reaching Ollama servers on the local network. The frontend is pure HTML/CSS/JS with no build step required.

### Prompting Model

All major workflows share a common prompt policy:

- XML-style sections separate instructions, context, inputs, and output contracts.
- Gemma-family models are auto-detected by model name and classified into small structured vs larger reasoning tiers.
- Reasoning traces are requested inside `<thought>`/`<think>` tags and kept hidden by default in the UI unless expanded.
- Structured workflows can trigger a critic/refinement pass when output is missing or fails a workflow validator.

This policy is intentionally app-wide, covering chat, persona drafting, meeting facilitation, attachment indexing, summaries, and draft-board generation.

## Project Structure

```
├── server.js          Bun HTTP server + /api/proxy endpoint
├── public/
│   ├── index.html     Application shell
│   ├── style.css      Layout, themes, and workspace shell styling
│   ├── inference-policy.js Shared Gemma/Ollama prompt policy
│   ├── chat.js        Chat workspace and streaming UI
│   ├── app.js         Sources, personas, meetings, and orchestration
│   └── markdown.js    Safe markdown renderer
├── tests/             Bun test coverage for prompt policy, parsing, and server validation
└── docs/              Architecture and testing notes for handoff/review
└── package.json
```

## Development

| Command | Description |
|---|---|
| `bun run dev` | Start server with hot reload |
| `bun run start` | Start server (production) |
| `bun run check` | Syntax-check the browser/server JavaScript |
| `bun run test` | Run Bun automated tests |

Requires [Bun](https://bun.sh) ≥ 1.0 and [Ollama](https://ollama.com) running locally.

## Review Notes

- Read [docs/architecture.md](docs/architecture.md) before changing workflow orchestration or prompt templates.
- Read [docs/testing.md](docs/testing.md) before extending the automated coverage.
- Treat Ollama model names, URLs, and streamed output as untrusted input.
