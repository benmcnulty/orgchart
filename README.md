# OrgChart: Paper Dolls for Corporate Theater

> A local operating environment for autonomous organizations built on Bun,
> Ollama, and Gemma 4.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Status and trust boundary

This is an experimental local application with committed tests, not a verified
production or multi-user service. The feature inventory below describes source
capabilities; this documentation review did not certify every autonomous flow.
The server binds to `127.0.0.1`; only local Host values on the serving port and
matching Origin values are accepted. Foreign/null origins and cross-site browser
requests are rejected before disk, tool or proxy routes. LAN hosting, reverse
proxies and cross-origin embeds are not supported. This local boundary is not
application authentication: trusted local processes can supply matching headers.
The app exposes mutable disk state and network/tool operations; its proxy does
not provide endpoint authorization or an inference/tool sandbox.

## What Is OrgChart?

OrgChart is a zero-dependency local web application that turns a set of local
inference resources into a governed organizational operating system. It now
centers the experience around app-like surfaces for setup, board oversight,
workflows, resources, intranet review, messaging, and diagnostics.

The name reflects the premise: language models playing assigned corporate roles,
doing the kind of structured, iterative knowledge work that organizations produce.
Paper dolls for corporate theater — disposable, interchangeable, surprisingly useful.

---

## Features

### Inference Source Management
- **Multi-source** — add any number of Ollama servers on your LAN
- **Capacity tiers** — tag each source as Small / Medium / Large; the pipeline
  uses explicit phase/source configuration; labels do not measure hardware capacity
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

### Operating Environment
- **Home launcher** — mobile-first app grid for entering the organization
- **Board app** — live operational dashboard for board-level visibility
- **Setup app** — guided onboarding and autonomy readiness checklist
- **Focused apps** — Organization, Messages, Workflows, Resources, Intranet, and Diagnostics

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

Run from the cloned repository root; no npm package installation or build step
is declared. Open [http://localhost:3000](http://localhost:3000). `PORT` overrides
the HTTP port; in PowerShell set `$env:PORT = '4000'` before `bun run dev`.
Stop the server with Ctrl+C. `bun run start` disables watch mode.

The ignored `.orgchart/` folder holds mutable instance data. Explore in a
disposable checkout or back up existing state before operations that change it.
Do not commit private organization records, local endpoints or model input.

Requires [Bun](https://bun.sh) ≥ 1.0 and [Ollama](https://ollama.com) running
with a suitable model already installed. The source's Gemma model identifiers
are defaults, not proof those names are available on your inference server.

---

## Hardware Setup

OrgChart supports multiple inference sources, with operator-assigned
Small/Medium/Large capacity tags. These are routing labels, not measured hardware
requirements or verified recommendations for a particular GPU. Choose an actually
installed model that fits each machine and test the intended workload; advertised
memory, model names and context windows alone do not establish capacity.

For multi-node setups, configure the Ollama node URLs:

```bash
OLLAMA_PRIMARY_URL=http://ollama-primary.example:11434 \
OLLAMA_SECONDARY_URL=http://ollama-secondary.example:11434 \
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
tools, intranet content, and agent memory. If the new store is empty, legacy
localStorage agent records are migrated automatically on first load.

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
│   ├── index.html         App shell and section mounts
│   ├── style.css          Shared design system and responsive shell
│   ├── nav.js             App navigation rail and active app state
│   ├── home.js            OS-style launcher and focus surfaces
│   ├── presentation.js    Board dashboard
│   ├── config-flow.js     Guided setup application
│   ├── agents.js          Agent editor and drafting flows
│   ├── management.js      Organization, roles, departments, teams
│   ├── tasks-mod.js       Scheduled task orchestration UI/state
│   ├── meetings.js        Meeting orchestration and facilitator flows
│   ├── projects.js        Projects and milestones
│   ├── intranet-mod.js    Knowledge / technology / records review surface
│   ├── sources.js         Inference source management
│   ├── skills.js          Skill configuration
│   ├── tools.js           Tool runtime configuration
│   ├── chat.js            Chat workspace and streaming UI
│   ├── pipeline.js        Multiphase Lab
│   ├── inference-policy.js Shared Gemma/Ollama prompt policy
│   ├── markdown.js        Safe markdown renderer
│   ├── shared.js          Shared DOM/fetch/panel helpers
│   └── app.js             Bootstraps the shared runtime and mounts the apps
├── tests/                 Bun test suite for prompt policy, parsing, server, pipeline, and store/runtime logic
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

## Reproducible checks and configuration notes

`bun run test` runs the committed Bun suite. `bun run check` uses the portable
Node checker in `scripts/check.js`, covering the same browser/lib/server sources.
Node.js is needed for syntax checks; no npm dependencies are installed. On
PowerShell, the equivalent explicit check is:

```powershell
Get-ChildItem public/*.js, lib/*.js, server.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE) { throw 'Syntax check failed' } }
```

`PORT` controls HTTP serving. `OLLAMA_PRIMARY_URL` defaults to
`http://localhost:11434`; `OLLAMA_SECONDARY_URL` defaults to the primary URL.
[`config/ollama-nodes.js`](config/ollama-nodes.js) routes optimizer/critic phases
to secondary and generator/synthesizer phases to primary unless a phase supplies
its own source URL. Browser source selections also use the server proxy.
Configured endpoints receive inference inputs; built-in research tools can make
external network requests. No credential or privacy guarantee follows from
calling the app local.

Read [AGENTS.md](AGENTS.md) and include actual automated and browser evidence
with changes. The 2026-10-02 candidate passed all 49 Bun tests and the 23-file Node
syntax check on Bun 1.4.2/Node 24, without live inference or built-in network
tools. Full browser/UI/manual autonomous-flow checks
remain unverified. Preserve the [MIT license](LICENSE) and existing source attribution.
