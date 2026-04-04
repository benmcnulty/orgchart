# Distributed Inference Dashboard

A local web application for managing and monitoring Ollama API inference sources across a network. Built as infrastructure for agentic systems that need to route inference across multiple locally-networked models.

## Features

- **Localhost default** — connects to `http://localhost:11434` on startup
- **Multi-source** — add any number of Ollama API servers on your LAN
- **Live model listing** — fetches available models from each source on connect
- **Smart defaults** — auto-selects `gemma4:latest` where available
- **Persistent** — source configuration survives page reloads (localStorage)
- **CORS-safe** — all Ollama API calls are proxied through the Bun server

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

## Project Structure

```
├── server.js          Bun HTTP server + /api/proxy endpoint
├── public/
│   ├── index.html     Application shell
│   ├── style.css      Dark theme UI
│   └── app.js         Frontend application logic
└── package.json
```

## Development

| Command | Description |
|---|---|
| `bun run dev` | Start server with hot reload |
| `bun run start` | Start server (production) |

Requires [Bun](https://bun.sh) ≥ 1.0 and [Ollama](https://ollama.com) running locally.
