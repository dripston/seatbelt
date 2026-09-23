# Spec notes: hooks, plugins, skills, marketplaces

Sourced from official docs at code.claude.com/docs/en/* (fetched 2026-09-22). Only fields this plugin actually uses are detailed; see links for full reference.

## Hooks — PreToolUse

Source: https://code.claude.com/docs/en/hooks

Input (stdin JSON):
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/home/user/my-project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "git push", "description": "...", "timeout": 120000 },
  "tool_use_id": "toolu_..."
}
```

Output (stdout JSON) — this is the only shape we need:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "free text shown to Claude"
  }
}
```

Rules we rely on:
- `hookEventName` must exactly match `"PreToolUse"`.
- `permissionDecision` ∈ `allow` / `deny` / `ask`. We use `deny` for guarded-rule matches, `ask` for built-in risky-command matches, and simply print nothing (or `allow`) otherwise.
- **Exit code 0 with valid JSON is sufficient** — exit 2 is only needed to force-block regardless of JSON, which we don't need since `permissionDecision: deny` already blocks.
- **Fail-open requirement**: if our script crashes or the file is unreadable, we must not accidentally block everything. We achieve this by wrapping all parsing in try/catch and defaulting to printing nothing (allow) plus a stderr log line on any internal error.
- stdout must be exactly `{...}` (starts with `{`, ends with `}`) to be parsed as JSON; anything else is treated as plain text and has no effect on permission (safe fallback).
- Default timeout for `command` hooks is 600s but our budget is self-imposed at <100ms — no timeout risk.

## Hooks — SessionStart

Source: https://code.claude.com/docs/en/hooks

Input adds:
```json
{ "session_id": "abc123", "cwd": "...", "hook_event_name": "SessionStart", "source": "startup|resume|clear|compact|fork" }
```

Output:
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart" }, "additionalContext": "text shown to Claude at session start" }
```

Rules we rely on:
- We only act when `source` is `"compact"` or `"resume"` (per plan). `"startup"` also included per plan's matcher `compact|resume` — NOTE: plan says fire on `compact|resume`, but does not include plain `startup`. We will match `source` against `compact` and `resume` only, so a fresh `startup` session does not get a redundant injection banner (rules are already fresh at cold start). This is a deliberate interpretation of the plan's matcher string.
- `additionalContext` becomes Claude-visible context — this is how we re-inject rules.
- If no critical block exists in the project, we output nothing (no `additionalContext` key) — per plan, "no noise."

**Known limitation (logged, not solved in v1)**: per docs.EVIDENCE.md, rule decay is also a continuous function of context depth within a single session that never compacts (bragboy's finding). SessionStart with `compact|resume` matcher does not address that case. Out of scope for v1; documented in DESIGN.md as a v0.2 candidate (depth-gated `UserPromptSubmit` hook).

## Plugin structure

Source: https://code.claude.com/docs/en/plugins-reference

Critical rule: `.claude-plugin/` contains ONLY `plugin.json`. Everything else (`hooks/`, `skills/`) lives at plugin root, sibling to `.claude-plugin/`, not inside it.

```
seatbelt/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── skills/
│   └── rule-guard/
│       └── SKILL.md
├── scripts/
│   ├── pre-bash.js
│   ├── session-start.js
│   └── lib/parse-rules.js
```

`plugin.json` required field: `name` (kebab-case). We'll use `"seatbelt"`. Optional fields we'll include: `displayName`, `version`, `description`, `author`, `license`.

`hooks/hooks.json` shape:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pre-bash.js\"" } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js\"" } ] }
    ]
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's install directory; documented as available in hook process env vars (not inside Bash tool commands in-session, which doesn't matter for us since it's only used in hooks.json).

Skills bundling: `skills/rule-guard/SKILL.md` is auto-discovered by directory convention; no extra plugin.json field needed.

## SKILL.md frontmatter

Source: https://code.claude.com/docs/en/skills

Required-in-practice fields we'll set: `name`, `description`. Frontmatter must start on the file's literal first line (`---`) or it's treated as plain content, not parsed.

Constraint: keep SKILL.md under 500 lines (plan already specifies <150).

## Marketplace

Source: https://code.claude.com/docs/en/plugin-marketplaces

`.claude-plugin/marketplace.json` required shape:
```json
{
  "name": "seatbelt-marketplace",
  "owner": { "name": "dripston" },
  "plugins": [
    { "name": "seatbelt", "source": "./", "description": "...", "version": "0.1.0" }
  ]
}
```
Validation command (documented): `claude plugin validate .` — will run this in Phase 6 if available in this environment; if the command doesn't exist locally, structure will be manually checked against the docs above instead, and this will be noted in PROGRESS.md.

## Version-gating caveat

Docs note several fields/behaviors are version-gated (e.g. features requiring v2.1.196+, v2.1.218+, v2.1.246+, v2.1.257+). We are not pinning to a specific Claude Code version in this build; if a validation step reveals a version mismatch, it will be logged in PROGRESS.md rather than silently worked around.

## Hook process model (checked during fix-pass Phase 4, latency investigation)

Source: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/hooks-guide

- **No warm/daemon/persistent process model is documented for `command`-type hooks.** Each invocation spawns a fresh process; this is stated implicitly by the mechanism's description ("Command hooks communicate through stdout, stderr, and exit codes only") with no mention of process reuse, socket-based hooks, or a daemon mode anywhere in the reference or guide.
- **`http` hooks** POST to an already-running server (avoids a local process spawn by Claude Code, but requires the user to run and maintain that server themselves).
- **`mcp_tool` hooks** call a tool on an "already-connected" MCP server — the docs explicitly note "the hook never triggers an OAuth or connection flow," confirming this reuses a persistent connection rather than spawning fresh. This is the only documented pattern resembling a warm process for hook logic, but it requires standing up an MCP server, which is a materially different architecture than a `command` hook script.
- **No documented latency/performance guidance for `command` hooks.** The only overhead-related mitigation mentioned anywhere is narrowing a hook's `matcher`/`if` condition so it only spawns for tool calls it actually cares about — this reduces how often a hook spawns, not how expensive each spawn is. No guidance on compiled binaries vs. Node, or any other spawn-cost-reduction technique, was found.

Implication: this plugin's `command`-type hooks (as specified in hooks/hooks.json) cannot avoid a fresh Node process spawn per Bash tool call given the currently-documented hook system. See evals/results/LATENCY_BREAKDOWN.md for the measured cost of that spawn versus this plugin's own code.
