# OrgChart: Paper Dolls for Corporate Theater — Testing Notes

MIT License © 2026 Ben McNulty

## Commands

- `bun run test` runs the Bun test suite.
- `bun run check` syntax-checks the browser/server JavaScript entrypoints.

## Current Coverage

The automated suite focuses on the highest-risk logic that does not require a browser harness:

- Gemma/Ollama prompt policy and model-tier detection
- structured `<thought>` / `<think>` parsing
- chat parser handling for streamed reasoning tags
- server-side proxy and stream payload validation

## Recommended Review Workflow

1. Run `bun run check`
2. Run `bun run test`
3. Start the app with `bun run dev`
4. Manually verify:
   - chat streaming and hidden reasoning panels
   - persona drafting
   - meeting auto mode
   - draft-board planning/revision
   - import/export snapshot flow

## Future Expansion

The next layer of test investment should be browser automation for:

- workspace rail collapse/expand behavior
- meeting/draft-board responsive layouts
- multi-source scheduling visibility
- session hydration after import
