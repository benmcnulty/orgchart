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

### Chat & Agents
- **Multi-session chat** — multiple concurrent conversations per source
- **Thinking visibility** — inline `<think>` / `<thought>` reasoning traces,
  collapsible per message
- **Agents** — disk-backed system instruction sets with reusable skill bindings
- **Skills** — Claude-style skill bundles with declared tool requirements
- **Tools** — configurable built-in runtime for web search, web scrape, Wikipedia research, and memory CRUD
- **Role assignment** — bind agents directly to organization roles
- **File attachments** — text, markdown, and image support
- **Context compression** — automatic background summarization when the context
  window fills up

### Management & Tasks
- **Management** — model one organization with departments, teams, and roles
- **Executive defaults** — Administration starts with CEO, COO, and CTO roles
- **Role-aware staffing** — see filled/unfilled roles and generate agents directly from roles
- **Scheduled tasks** — run meetings or memory consolidation manually or on recurring schedules
- **Continuity-aware meetings** — repeated meeting tasks carry forward summary and retrospective context
- **Operations board** — keep scheduled and completed runs visible with collapsible detail
- **Global Active switch** — one top-level control gates autonomous and scheduled background behavior

### Meetings & Orchestration
- **Group chat** — multiple AI participants with distinct agents
- **Meeting auto-mode** — facilitator routes turns, surfaces consensus and action items, and now stops when end conditions are met
- **Retrospectives** — completed meetings distill participant learnings into working memory
- **Board messages** — facilitator and automation can notify the board through the global bell tray
- **Draft boards** — collaborative iterative document generation
- **Autosave feedback** — the header save indicator reflects successful or failed local persistence

### Intranet & Custom Tooling
- **Intranet** — disk-backed `Knowledge`, `Technology`, and `Records` workspaces
- **Records** — persistent meeting transcripts, completed task runs, and generated artifacts
- **Knowledge wiki** — markdown-based institutional knowledge for onboarding, process docs, and internal guidance
- **Technology studio** — reviewed custom JavaScript tools with docs, safe test inputs, and manual run/test surfaces
- **Technologist skill** — built-in capability set for CTO-style tool design, patching, testing, and documentation

### Multiphase Lab
- **Multi-project workspace** — keep multiple lab projects in a shared sidebar
- **Editable phase plans** — enable, disable, reorder, and add custom phases
- **Per-phase agents** — apply saved agent instructions to individual phases
- **Capacity-aware routing** — phases assigned to sources by hardware tier
- **Streaming display** — visible output streams cleanly without duplicated reasoning tags
- **Thinking panels** — full reasoning traces stay available per phase, hidden by default while they stream
- **Endpoint priming** — selected source/model pairs are pre-warmed in parallel with fast keep-alive loads
- **Self-healing retries** — timeout-like phase failures trigger a warm-up pass and one automatic retry
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

### OrgChart Runtime Store

```text
.orgchart/
├── agents/<agent-slug>.md
├── custom-tools/<tool-slug>/
│   ├── tool.json
│   ├── index.js
│   └── README.md
├── intranet/
│   ├── knowledge/*.md
│   ├── technology/*.md
│   └── records/*.md
├── skills/<skill-slug>/SKILL.md
├── tools/<tool-id>.json
└── data/<agent-slug>/
    ├── working-memory/
    ├── longterm-memory/
    ├── working-memory.json
    └── longterm-memory.json
```

The browser now treats `.orgchart/` as the source of truth for agents, skills,
tools, and agent memory. If the new store is empty, legacy localStorage agent
records are migrated automatically on first load.

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
Before a run starts, the server kicks off a parallel warm-up pass for each
unique selected `(source, model)` pair using a lightweight keep-alive preload.
Phase execution does not fully block on that work; each phase only gives its
target model a short head start so the UI stays responsive while later models
continue warming in the background. If a phase still fails with a timeout-like
transport error, the runner re-primes that model and retries the phase once.

---

## Project Structure

```
├── LICENSE
├── server.js              Bun HTTP server, proxy, and pipeline SSE endpoint
├── lib/
│   ├── gemma4-utils.js    Thinking-block strip/extract utilities
│   ├── orgchart-store.js  Disk-backed `.orgchart` storage and tool runtime helpers
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
│   └── app.js             Sources, agents, meetings, and orchestration
├── tests/                 Bun test suite (prompt policy, parsing, server, pipeline utils, orgchart store)
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
