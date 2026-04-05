# OrgChart: Paper Dolls for Corporate Theater — Architecture Notes

MIT License © 2026 Ben McNulty

## Runtime Shape

- `server.js` serves static assets, proxies Ollama requests, and exposes the OrgChart disk/runtime APIs.
- `lib/orgchart-store.js` owns the `.orgchart` disk layout for agents, skills, tools, intranet documents, custom tools, projects, and per-agent memory sandboxes.
- `public/app.js` bootstraps shared state and mounts the app surfaces.
- `public/nav.js` manages active-app navigation.
- `public/home.js` renders the launcher/home surface.
- `public/presentation.js` renders the board dashboard.
- `public/config-flow.js` renders the guided setup experience.
- `public/management.js`, `public/agents.js`, `public/sources.js`, `public/skills.js`, `public/tools.js`, `public/tasks-mod.js`, `public/meetings.js`, `public/projects.js`, and `public/intranet-mod.js` each own a focused domain surface on top of the same shared state.
- `public/inference-policy.js` remains the shared prompt/orchestration policy for Gemma/Ollama workflows.

## Prompt Policy

The app uses a single structured prompting model:

- XML-delimited sections for workflow, rules, context, input, and output contract
- automatic Gemma-family model tier detection from the Ollama model name
- hidden-by-default reasoning traces using `<thought>` / `<think>` tags
- optional critic/refinement pass for structured workflows when output is empty or invalid

This keeps prompt behavior consistent across:

- chat replies
- agent drafting
- meeting agenda generation
- facilitator planning
- participant turns
- summary and long-memory refresh
- attachment indexing
- draft-board planning and revision

## OrgChart Store

OrgChart mirrors Claude-style content organization under `.orgchart/`:

- `agents/<agent-slug>.md`
- `skills/<skill-slug>/SKILL.md`
- `tools/<tool-id>.json`
- `data/<agent-slug>/working-memory/`
- `data/<agent-slug>/longterm-memory/`
- `data/<agent-slug>/working-memory.json`
- `data/<agent-slug>/longterm-memory.json`

The Bun server is the only writer for this store. The browser loads the full
catalog through `/api/orgchart/bootstrap`, writes changes back through explicit
CRUD endpoints, and treats localStorage as cache/runtime state only.

Skills declare tool dependencies. Agents bind skills. The effective agent prompt
is the agent instructions plus a capability summary derived from the selected
skills and enabled tools. Agents can also bind to organization roles, which
lets meetings and scheduled tasks select participants by department or team.

## Tool Runtime

The built-in runtime exposes MCP-shaped capabilities through Bun endpoints:

- `web_search` uses DuckDuckGo HTML search and normalizes structured results.
- `web_scrape` fetches a URL and extracts readable text.
- `wikipedia` searches Wikipedia, resolves the best topic match, and returns focused encyclopedic context.
- `memory_read`, `memory_write`, `memory_update`, and `memory_delete` are
  sandboxed to `.orgchart/data/<agent-slug>/...`.

## Meeting Orchestration

Meetings run through a queue-based scheduler in `public/app.js`.

- Blocking tasks run one-at-a-time across all sources.
- Parallel tasks use the next available connected source.
- Token flow records stream start/end boundaries plus aggregated reasoning/output traces.
- Facilitator context combines agenda, explicit end conditions, summary, working memory, attachments, board notes, transcript tail, and draft boards.
- Participants can receive injected web-research and memory context when their assigned skills allow it.
- Completed meetings trigger a retrospective pass that writes participant learnings into working memory.

## App Shell

The browser UI now behaves like a small operating environment rather than a flat
panel stack. The primary app surfaces are:

- `Home`
- `Board`
- `Setup`
- `Organization`
- `Messages`
- `Workflows`
- `Resources`
- `Intranet`
- `Diagnostics`

Mobile uses a touch-first launcher plus bottom navigation. Tablet/desktop keep
the same app model with denser layouts, but only one primary app surface is
active at a time.

## Management and Task Scheduling

- Organizations contain departments, teams, and roles.
- Roles can be filled by assigning an existing agent or by generating a new role-optimized agent.
- Scheduled tasks can run meetings or trigger all-agent memory consolidation.
- A global application automation toggle gates all autonomous and scheduled background execution.
- The intranet stores read-first Knowledge and Technology markdown plus system-managed Records for meetings and task runs.
- Custom tools are reviewed JavaScript modules in `.orgchart/custom-tools/` and execute only through the Bun-managed registry wrapper.
- Recurring tasks execute only while the app is open and the global task auto-toggle is enabled.

## Pipeline Streaming and Recovery

The multiphase lab uses a split-channel stream contract:

- `thinking` deltas are stored and rendered in a hidden-by-default reasoning panel
- `output` deltas are streamed directly into the visible response surface
- the canonical stored phase record is rebuilt once from the final buffers so repeated reasoning tags never leak into the user-facing stream

Before a run starts, the server launches a parallel warm-up task for each
unique selected `(sourceUrl, model)` pair using a lightweight `/api/generate`
keep-alive request. Phases do not wait for the full warm-up set to finish; each
phase only gives its own target a short head start, which keeps the interface
responsive while other selected endpoints continue loading in the background.

If a phase fails with a timeout-like transport error, the runner emits a retry
event, re-primes that same target, and retries the phase once. This keeps the
pipeline resilient to cold Ollama models without silently looping forever.

The client-side lab now manages multiple saved pipeline projects. Each project
stores its own prompt, ordered phase plan, per-phase source/model selection,
optional agent instructions, and latest run record. The server executes only
the enabled ordered phase definitions it receives from the active project.

## Extension Guidance

When adding new autonomous workflows:

1. Add a new workflow name to the shared prompt policy.
2. Define its output contract and validator before wiring UI.
3. Reuse the queue/critic/stream tracing path instead of making direct one-off fetch calls.
4. Prefer adding capability to an existing app surface before creating a new top-level app.
5. Keep public UI reasoning hidden by default unless the workflow explicitly needs it surfaced.
