# Jasper Agentplace agent — sanitized reference snapshot

This folder is a learning-oriented snapshot of selected agent-owned source. It is not a standalone application or a complete Agentplace runtime. It preserves Jasper's agent instruction, configuration, custom booking workflow (including tests), client branding/theme, business-hours skill, and project documentation.

## Sanitization and omissions

- The quote endpoint is replaced with `https://example.invalid/api/quote`.
- The booking spreadsheet and primary calendar identifiers are replaced with `REPLACE_WITH_SPREADSHEET_ID` and `REPLACE_WITH_PRIMARY_CALENDAR_ID`.
- The example customer in the specification and tests is synthetic (`Sample Customer`, `customer@example.invalid`).
- No credentials, tokens, `.env.runtime`, `.agent/mcp.json`, platform runtime/infrastructure, or vendored code are included. Empty custom-surface registries are omitted.

The workflow imports Agentplace-managed types and integration adapters that are intentionally not copied here. Connections, permissions, deployment configuration, and provider-specific runtime contracts must be supplied by an authorized Agentplace environment. The placeholders are not live settings; this reference must not be used to process bookings as-is. The included tests use mocked integrations and do not create bookings.

## Snapshot contents

- `agent-dev-server/src/instruction.md` — Jasper's customer-facing behavior and booking response contract.
- `agent-dev-server/src/config.ts` — agent model, localization, and voice choices.
- `agent-dev-server/src/bl/tools/impl/` — custom booking workflow and its tests.
- `agent-dev-client/src/app/agent/` — Jasper brand name and theme.
- `.agent/skills/appointment-hours/SKILL.md` — business-hours knowledge.
- `.agentplace/` — product, workflow, and visual-direction notes.
