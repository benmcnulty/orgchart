# OrgChart: Paper Dolls for Corporate Theater — Repository Guidelines

MIT License © 2026 Ben McNulty

## Project Structure & Module Organization
This repo is a small Bun application with no build step. `server.js` serves static files from `public/`, proxies Ollama requests, and exposes the OrgChart disk runtime APIs. Keep browser code in `public/`: `index.html` is the shell, `app.js` manages sources, agents, skills, tools, and meetings, `chat.js` handles chat state and streaming, `markdown.js` renders message content, and `style.css` contains the theme and layout tokens. Disk-backed agent state lives under `.orgchart/` and is managed through `lib/orgchart-store.js`, not direct browser writes.
Shared Gemma/Ollama prompting rules live in `public/inference-policy.js`. Architecture and testing notes for review handoff live under `docs/`.

## Build, Test, and Development Commands
Use Bun for local work:

- `bun run dev` starts the server with `--watch` on port `3000`.
- `bun run start` runs the server without file watching.
- `bun run check` syntax-checks the browser/server entrypoints.
- `bun run test` runs the Bun automated test suite.
- `PORT=4000 bun run dev` starts the app on a different port when `3000` is busy.

## Coding Style & Naming Conventions
Match the existing plain JavaScript style: ES modules, semicolons, and 2-space indentation. Prefer descriptive camelCase for variables and functions such as `connectSource` and `chatRefreshSourceSelector`; keep constants uppercase, for example `DEFAULT_MODEL`. In frontend code, use DOM APIs like `createElement` and `textContent` instead of `innerHTML` when rendering user-controlled content. Keep CSS tokens and theme values in `public/style.css`, and preserve the current filename pattern of lowercase files in `public/`. New agents and skills should follow the lowercase Claude-style slug pattern used in `.orgchart/agents/<slug>.md` and `.orgchart/skills/<slug>/SKILL.md`.
When adding inference behavior, route new workflows through the shared prompt policy instead of inlining new one-off prompts in feature code. Prefer XML-delimited instructions and explicit output contracts for Gemma/Ollama calls.

## Testing Guidelines
Automated coverage now lives under `tests/`. For changes, run `bun run check` and `bun run test`, then verify behavior manually by running `bun run dev` and checking:

- source add/remove and reconnect flows
- theme toggle and persistence
- chat streaming, attachments, and source selection
- meeting auto mode, attachments, and draft boards
- disk-backed agent/skill/tool edits under `.orgchart/`
- import/export snapshot flow

## Commit & Pull Request Guidelines
Follow the existing Conventional Commit pattern seen in history: `feat: ...` for features; use `fix: ...`, `docs: ...`, or similar for other work. Keep subjects imperative and concise. Pull requests should explain the user-visible change, note any Ollama or LAN setup needed for review, and include screenshots or short recordings for UI updates.

## Security & Configuration Notes
Treat Ollama URLs, model names, and streamed text as untrusted input. Do not bypass the server proxy for LAN requests, and avoid introducing raw HTML rendering in the client.
