# Architecture Notes

## Runtime Shape

- `server.js` serves static assets and proxies Ollama requests through `/api/proxy` and `/api/stream`.
- `public/inference-policy.js` is the shared prompt/orchestration policy for Gemma/Ollama workflows.
- `public/chat.js` owns multi-chat state, streaming rendering, and hidden reasoning UX.
- `public/app.js` owns sources, personas, meetings, draft boards, task queues, and import/export.

## Prompt Policy

The app uses a single structured prompting model:

- XML-delimited sections for workflow, rules, context, input, and output contract
- automatic Gemma-family model tier detection from the Ollama model name
- hidden-by-default reasoning traces using `<thought>` / `<think>` tags
- optional critic/refinement pass for structured workflows when output is empty or invalid

This keeps prompt behavior consistent across:

- chat replies
- persona drafting
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

## Extension Guidance

When adding new autonomous workflows:

1. Add a new workflow name to the shared prompt policy.
2. Define its output contract and validator before wiring UI.
3. Reuse the queue/critic/stream tracing path instead of making direct one-off fetch calls.
4. Keep public UI reasoning hidden by default unless the workflow explicitly needs it surfaced.
