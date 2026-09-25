# Changelog

## v0.2.0 — scope cut: re-injection only

**Enforcement removed.** v0.1.0's `PreToolUse` hook (command-level deny/ask against risky Bash commands) is cut. Two rounds of structural-detection work found its recall against tools it hadn't seen before was unstable and ecosystem-dependent (12%, then 60%, then 40% across three independently-built blind tests), which is not a foundation to ship a safety claim on. The removed code and its full evaluation history are preserved on the `archive/enforcement` branch, not deleted.

**seatbelt's remaining and only job: keep the user's own CLAUDE.md/AGENTS.md rules alive in context.** It reminds; it does not enforce.

- Removed: `scripts/pre-bash.js`, `scripts/risky-commands.js`, `scripts/lib/assess-reversibility.js`, `scripts/lib/split-command.js`, `scripts/lib/tokenize-command.js`, `scripts/lib/structural-danger.js`, their tests, and the `PreToolUse` hook registration.
- Added: three content modes for what gets re-injected (`block` / `full` / `auto`, `scripts/lib/select-content.js`) — `auto` is now the default, injecting the whole rules file when it fits a token budget so users don't need to learn the marker syntax.
- Added: a third re-injection trigger, context depth. New `UserPromptSubmit` hook (`scripts/depth-check.js`) estimates transcript token depth and re-injects past a threshold (default 100,000 tokens, then every 50,000), independent of compaction — addressing a gap that a session which never compacts still loses adherence purely from depth.
- Added: `.claude/seatbelt.json` project configuration (`firstFire`, `interval`, `mode`, `maxInjectTokens`, `minTurnsBetween`).
- Added: `scripts/session-end.js` (`SessionEnd` hook) to clean up depth-tracking state.
- Fixed: `session-start.js` was emitting `additionalContext` at the wrong JSON nesting level (top-level instead of under `hookSpecificOutput.additionalContext`), meaning `SessionStart` re-injection — the original v0.1.0 feature — was a silent no-op against the real Claude Code hook contract the whole time. Found via a live `--debug hooks` trace, not by any unit test. New end-to-end schema tests guard against this regressing silently again.
- Fixed: rule and config discovery only ever checked the exact working directory, so a session started in a monorepo subdirectory (`cd packages/api && claude`) found zero rules even with a valid `CLAUDE.md` at the repo root. Discovery now walks upward toward a `.git` boundary or 10 levels, merging rules found at every level.
- README and SKILL.md rewritten around the reduced scope; every enforcement claim and accuracy number from v0.1.0 removed from user-facing docs (preserved in `archive/enforcement` and in git history).

## v0.1.0

Initial release.

- `PreToolUse` hook on Bash: checks commands against user-defined critical rules (`[guard: pattern]` tags) and a built-in risky-command list (git push/force-push, git reset --hard, git clean -f, git branch -D, rm -rf, git checkout -- ., common deploy commands). Denies on guarded-rule match, asks on built-in-list match, silent allow otherwise. Fails open on any internal error.
- `SessionStart` hook: re-injects critical rules as context on `compact` and `resume` events.
- `rule-guard` skill: helps users write critical blocks and documents the self-check protocol and known limitations.
- Discovers rules from `CLAUDE.md`, `.claude/CLAUDE.md`, and `AGENTS.md`, merging all found blocks.
- Configurable risky-command list via `rule-guard.config.json`.
- 34 unit tests (parser, PreToolUse decision logic, SessionStart context building) + 10/10 integration evals against real hook processes.

### Known limitations (see README)

- Does not address rule decay from context depth alone in a session that never compacts (only compact/resume trigger re-injection).
- Does not fix AGENTS.md truncation on very long files.
- Regex-based command matching can false-positive on quoted strings that resemble risky commands.
- Claude Code only — Cursor/Codex support is out of scope for v1.
