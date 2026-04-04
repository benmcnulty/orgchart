# OrgChart: Paper Dolls for Corporate Theater

> A local AI lab for distributed inference, multiphase prompt pipelines, and
> agentic workflow experimentation — built on Ollama and Gemma 4.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What Is OrgChart?

OrgChart is a zero-dependency local web application that turns your network of
Ollama inference nodes into a coordinated AI workforce. It manages sources,
routes workloads by hardware capacity, runs structured multiphase pipelines,
and surfaces all intermediate reasoning artifacts for inspection.

The name reflects the premise: language models playing assigned corporate roles,
doing the kind of structured, iterative knowledge work that organizations produce.
Paper dolls for corporate theater — disposable, interchangeable, surprisingly useful.

---

## Features

### Inference Source Management
- **Multi-source** — add any number of Ollama servers on your LAN
- **Capacity tiers** — tag each source as Small / Medium / Large; the pipeline
  routes phases to the most appropriate machine automatically
- **Live model listing** — fetches available models on connect; auto-retries on error
- **Smart defaults** — selects `gemma4:latest` where available
- **Persistent** — configuration survives page reloads via localStorage

### Chat & Personas
- **Multi-session chat** — multiple concurrent conversations per source
- **Thinking visibility** — inline `<think>` / `<thought>` reasoning traces,
  collapsible per message
- **Personas** — save system instruction sets; draft with AI assistance
- **File attachments** — text, markdown, and image support
- **Context compression** — automatic background summarization when the context
  window fills up

### Meetings & Orchestration
- **Group chat** — multiple AI participants with distinct personas
- **Meeting auto-mode** — facilitator routes turns, surfaces consensus and action items
- **Draft boards** — collaborative iterative document generation
- **Session snapshots** — full import/export of all in-flight state

### Multiphase Lab
- **Four-phase pipeline** — Optimizer → Generator → Critic → Synthesizer
- **Capacity-aware routing** — phases assigned to sources by hardware tier
- **Streaming display** — tokens stream live into phase cards as they arrive
- **Thinking panels** — full chain-of-thought visibility per phase, collapsed by default
- **Run documentation** — synthesizer appends a structured improvement log
- **Retry from failure** — resume pipeline from a failed phase without rerunning earlier work
- **Export as JSON** — full `PipelineRun` record for offline analysis

---

## Quick Start

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Requires [Bun](https://bun.sh) ≥ 1.0 and [Ollama](https://ollama.com) running
with at least one model pulled (`ollama pull gemma4:latest`).

---

## Hardware Setup

OrgChart is designed for multi-node LAN inference. Recommended capacity tagging
for common hardware:

| Machine | VRAM | Tier | Best Models |
|---|---|---|---|
| M4 MacBook Pro 32GB | 32 GB unified | **Large** | gemma4:31b, gemma4:26b |
| HP Victus / RTX 3060 | 16 GB GPU | **Medium** | gemma4:26b (MoE), gemma4:e4b |
| M2 Mac Mini 8GB | 8 GB unified | **Small** | gemma4:e2b, gemma4:e4b |

Set the capacity tier on each source card after connecting. The Multiphase Lab
will automatically route the Optimizer and Critic phases to Small/Medium nodes,
and the Generator and Synthesizer phases to Large/Medium nodes.

For multi-node setups, configure the Ollama node URLs:

```bash
OLLAMA_PRIMARY_URL=http://192.168.x.vic:11434 \
OLLAMA_SECONDARY_URL=http://192.168.x.pav:11434 \
bun run dev
```

---

## Architecture

```
browser  ──GET  /api/proxy?url=<ollama-url>──►  Bun server  ──►  Ollama /api/tags
         ──POST /api/stream?url=<ollama-url>──►              ──►  Ollama /api/chat (streaming)
         ──POST /api/pipeline/run           ──►              ──►  Ollama (4-phase SSE pipeline)
```

The Bun server is the only network boundary between browser and Ollama — all
inference calls are proxied to avoid CORS issues on LAN addresses.

### Prompting Model

All workflows use the shared `InferencePolicy` layer:
- XML-delimited system sections (`<workflow>`, `<execution_rules>`, `<input_data>`)
- Gemma-family auto-detection and tier classification (small_structured / large_reasoning)
- Reasoning traces in `<thought>`/`<think>` tags, collapsed in the UI by default
- Critic/refinement pass when output fails a workflow validator

### Pipeline Architecture

```
[User Input]
     │
     ▼
Phase 1: Optimizer   ── rewrites prompt for maximum generator effectiveness
     │
     ▼
Phase 2: Generator   ── primary content generation from optimized prompt
     │
     ▼
Phase 3: Critic      ── structured multi-axis quality evaluation
     │
     ▼
Phase 4: Synthesizer ── final revised output + run documentation block
```

Thinking blocks are stripped between phases. Only clean content passes forward.

---

## Project Structure

```
├── LICENSE
├── server.js              Bun HTTP server, proxy, and pipeline SSE endpoint
├── lib/
│   ├── gemma4-utils.js    Thinking-block strip/extract utilities
│   └── pipeline-runner.js Four-phase pipeline orchestration
├── config/
│   └── ollama-nodes.js    Multi-node URL config (env var driven)
├── public/
│   ├── index.html         Application shell
│   ├── style.css          Layout, themes, and workspace styling
│   ├── inference-policy.js Shared Gemma/Ollama prompt policy
│   ├── markdown.js        Safe markdown renderer (no innerHTML)
│   ├── chat.js            Chat workspace and streaming UI
│   ├── pipeline.js        Multiphase Lab UI panel
│   └── app.js             Sources, personas, meetings, and orchestration
├── tests/                 Bun test suite (prompt policy, parsing, server, pipeline utils)
└── docs/                  Architecture and testing notes
```

---

## Development

| Command | Description |
|---|---|
| `bun run dev` | Start with hot reload on port 3000 |
| `bun run start` | Production start |
| `bun run check` | Syntax-check all JS |
| `bun run test` | Run automated tests |
| `PORT=4000 bun run dev` | Use a different port |

---

## Review Notes

- Read [docs/architecture.md](docs/architecture.md) before changing workflow
  orchestration or prompt templates.
- Read [docs/testing.md](docs/testing.md) before extending test coverage.
- Treat Ollama model names, URLs, and streamed output as untrusted input.
- Do not bypass the server proxy for LAN requests.
- Do not render user-controlled strings via `innerHTML`.

---

## License

MIT © 2026 Ben McNulty — see [LICENSE](LICENSE).

---

*OrgChart: Paper Dolls for Corporate Theater*
