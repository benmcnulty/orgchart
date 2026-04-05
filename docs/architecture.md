# OrgChart: Paper Dolls for Corporate Theater — Architecture Notes

MIT License © 2026 Ben McNulty

## Runtime Shape

- `server.js` serves static assets and proxies Ollama requests through `/api/proxy` and `/api/stream`.
- `public/inference-policy.js` is the shared prompt/orchestration policy for Gemma/Ollama workflows.
- `public/chat.js` owns multi-chat state, streaming rendering, and hidden reasoning UX.
- `public/app.js` owns sources, agents, meetings, draft boards, task queues, and import/export.

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

## Meeting Orchestration

Meetings run through a queue-based scheduler in `public/app.js`.

- Blocking tasks run one-at-a-time across all sources.
- Parallel tasks use the next available connected source.
- Token flow records stream start/end boundaries plus aggregated reasoning/output traces.
- Facilitator context combines agenda, summary, working memory, attachments, board notes, transcript tail, and draft boards.

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
4. Keep public UI reasoning hidden by default unless the workflow explicitly needs it surfaced.
