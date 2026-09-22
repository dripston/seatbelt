# Changelog

## v0.1.0

Initial release.

- `PreToolUse` hook on Bash: checks commands against user-defined critical rules (`[guard: pattern]` tags) and a built-in risky-command list (git push/force-push, git reset --hard, git clean -f, git branch -D, rm -rf, git checkout -- ., common deploy commands). Denies on guarded-rule match, asks on built-in-list match, silent allow otherwise. Fails open on any internal error.
- `SessionStart` hook: re-injects critical rules as context on `compact` and `resume` events.
- `rule-guard` skill: helps users write critical blocks and documents the self-check protocol and known limitations.
- Discovers rules from `CLAUDE.md`, `.claude/CLAUDE.md`, and `AGENTS.md`, merging all found blocks.
- Configurable risky-command list via `rule-guard.config.json`.
- 34 unit tests (parser, PreToolUse decision logic, SessionStart context building) + 10/10 integration evals against real hook processes.

### Known limitations (see README and docs/DESIGN.md)

- Does not address rule decay from context depth alone in a session that never compacts (only compact/resume trigger re-injection).
- Does not fix AGENTS.md truncation on very long files.
- Regex-based command matching can false-positive on quoted strings that resemble risky commands.
- Claude Code only — Cursor/Codex support is out of scope for v1.
