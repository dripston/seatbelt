# seatbelt

**Problem:** Claude Code agents follow your CLAUDE.md/AGENTS.md rules at first, then silently drop them — after context compaction, in long sessions, or when editing through Bash instead of the Edit tool.

**Fix:** two deterministic hooks (not more instructions) that re-inject critical rules after compaction and block/ask before risky shell commands run.

## Install

```bash
# Add this repo as a marketplace source, then install the plugin by name:
claude plugin marketplace add dripston/seatbelt
claude plugin install seatbelt

# Testing from a local clone instead of GitHub (must start with ./ or be absolute):
claude plugin marketplace add ./path/to/local/seatbelt
claude plugin install seatbelt
```

## Critical block example

Add this to `CLAUDE.md`, `.claude/CLAUDE.md`, or `AGENTS.md`:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first. [guard: git push]
- Never delete files in migrations/. [guard: rm * migrations/*]
- Always run tests before committing.
<!-- /rule-guard:critical -->
```

Rules with a `[guard: pattern]` tag are checked against every Bash command before it runs. Rules without one are re-injected as context after compaction/resume, but can't be mechanically enforced (they're not tied to a specific command).

## Demo

![demo](docs/demo.gif)
<!-- TODO: record per docs/DEMO_SCRIPT.md -->

## How it works

- **`PreToolUse` hook on Bash**: splits chained commands (`&&`, `;`, `|`), checks each segment against your guarded rules and a built-in risky-command list (`git push`, `--force`, `rm -rf`, `git reset --hard`, common deploy commands). A guarded-rule match denies the command and quotes your rule back. A built-in-list match with no matching rule asks for confirmation instead of blocking outright.
- **`SessionStart` hook**: on `compact` or `resume`, re-reads your critical block and re-injects it as context, so rules don't quietly fall out of the model's effective attention after a summary.
- Both hooks fail open: if parsing crashes or a file is malformed, the hook logs to stderr and allows the action rather than bricking your session.

## What this does NOT fix

- **AGENTS.md truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug, not something a hook can patch.
- **Rule decay from pure context depth in a session that never compacts.** A 2026-09-22 empirical report on [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) shows even mechanical rules decay continuously with context depth, independent of compaction. v1's `SessionStart` hook only fires on compact/resume, so it won't help a long, never-compacted session. A depth-gated `UserPromptSubmit` trigger is a candidate for v0.2.
- **A regex-based command matcher can't tell a quoted string from a real invocation.** `echo "git push"` will still trigger an "ask" — a deliberate false-positive tradeoff over risking a missed real one.
- **Model-level quality regressions and other issues that need a Claude Code binary change** — not in scope for a skill/hook plugin.

## Prior art

[Cozempic](https://github.com/Ruya-AI/cozempic) already does `SessionStart`-hook-based rule-freshness reminders as part of its broader context-pruning tool. seatbelt's distinct piece is deterministic **command-level enforcement** (deny/ask on specific risky Bash commands against your rules) — not just rule re-injection. If you only need pruning + reminders, Cozempic may already cover your case.

## Evidence

This isn't a guess at a problem — it's built against a documented, still-open gap:
- [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) — re-injection feature request, citing 7 prior duplicate reports
- [anthropics/claude-code#88565](https://github.com/anthropics/claude-code/issues/88565) — auto mode routes edits through Bash, which never triggers path-scoped rule injection
- [anthropics/claude-code#81999](https://github.com/anthropics/claude-code/issues/81999) — agent auto-commits/pushes after a few approval cycles despite an explicit "every time, no exceptions" rule
- [anthropics/claude-code#34197](https://github.com/anthropics/claude-code/issues/34197), [#43716](https://github.com/anthropics/claude-code/issues/43716) — CLAUDE.md ignored in long sessions

Full evidence log with verification notes: [docs/EVIDENCE.md](docs/EVIDENCE.md). Design rationale: [docs/DESIGN.md](docs/DESIGN.md).

## Contributing

Issues and PRs welcome. Run `node --test tests/*.test.js` for unit tests and `node evals/run-evals.js` for integration evals before submitting.

## License

MIT
