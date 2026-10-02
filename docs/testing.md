# OrgChart: Paper Dolls for Corporate Theater — Testing Notes

MIT License © 2026 Ben McNulty

## Commands

- `bun run test` runs the Bun test suite.
- `bun run check` syntax-checks every browser module, `lib/*.js`, and `server.js`.

## Current Coverage

The automated suite focuses on the highest-risk logic that does not require a browser harness:

- Gemma/Ollama prompt policy and model-tier detection
- structured `<thought>` / `<think>` parsing
- chat parser handling for streamed reasoning tags
- server-side proxy and stream payload validation
- loopback listener plus foreign Host/Origin and cross-site request rejection before privileged routing
- `.orgchart` markdown/config parsing and memory sandbox path rules
- intranet document persistence and custom-tool registry validation rules
- multiphase pipeline primer deduplication, parallel warm-up scheduling, timeout retry policy, and split thinking/output stream handling
- role-aware agent generation and scheduled-task UI/state should be manually smoke-tested

## Recommended Review Workflow

1. Run `bun run check`
2. Run `bun run test`
3. Start the app with `bun run dev`
4. Manually verify:
   - home launcher, app navigation, and narrow/mobile layout behavior
   - setup step completion, locking, and app-launch actions
   - agent draft vs revise flows and role assignment
   - management org chart editing, role fill states, and generate-agent-from-role
   - tool runtime configuration and test probes, including Wikipedia lookups
   - meeting auto mode, explicit completion, and retrospective memory writes
   - records emission for meetings and completed task runs
   - custom tool registry safety checks and manual test execution
   - scheduled task editing, continuity notes, and manual run behavior
   - `.orgchart` migration from legacy localStorage agents on first launch
   - multiphase lab warm-up status, hidden reasoning panels, and retry-from-timeout behavior

## Future Expansion

The next layer of test investment should be browser automation for:

- app launcher navigation and mobile bottom dock behavior
- setup-step interactions and readiness gating
- workflow and resources responsive layouts
- meeting/draft-board responsive layouts

## Local transport regression boundary

`tests/local-boundary.test.js` checks real local HTTP serving and hostile request rejection. It uses an ephemeral port, closes the listener, and does not submit inference, disk mutations or tool execution. Matching headers from trusted native local processes remain allowed; this is not application authentication or a network-hosting mode. Candidate CI performs syntax/tests with read-only repository permissions and no deployment step. Browser and live-model checks above remain a separate manual acceptance task.

The follow-up includes a default HTTP port regression without binding port 80 and fake-secret diagnostics tests. Stream target diagnostics omit URL userinfo/path/query; network exception messages are generic and logged error classes are bounded. These checks are not a full privacy or outbound-network audit.
