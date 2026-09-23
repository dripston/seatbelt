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

- **`PreToolUse` hook on Bash**: splits chained commands (`&&`, `;`), runs a lightweight command-structure pass (`scripts/lib/tokenize-command.js`) to tell a real invocation apart from a risky-looking phrase that's just sitting inside a comment, a quoted string, a filename, or a read-only command's arguments (`grep`, `cat`, `echo`, `git log`, etc.) — then checks only the real invocation text against your guarded rules and a built-in risky-command list (git history/remote mutation, package publish/release, infra destroy, system operations, filesystem destruction — see `scripts/risky-commands.js` for the full, categorized list). A guarded-rule match denies the command and quotes your rule back. A built-in-list match with no matching user rule asks for confirmation instead of blocking outright — deny is reserved for rules you explicitly wrote.
- **`SessionStart` hook**: on `compact` or `resume`, re-reads your critical block and re-injects it as context, so rules don't quietly fall out of the model's effective attention after a summary.
- Both hooks fail open: if parsing crashes or a file is malformed, the hook logs to stderr and allows the action rather than bricking your session, and warns you if a CLAUDE.md/AGENTS.md file exists but no rule block was recognized in it.

## Measured accuracy (not a guess — see evals/results/VERDICT-2.md for the full methodology)

Tested against a 518-row dataset (real commands from actual shell history plus hand-labeled synthetic and adversarial cases, labeled independently of the implementation):

- **Dangerous-command recall: 99.1%** (107/108) — catches the git/publish/infra/system/filesystem-destructive actions it's built for.
- **False positives on safe, everyday commands: 0.0%** (0/218) — won't nag you during ordinary work.
- **Precision when it hard-denies something: 100.0%** — a `deny` from seatbelt can be trusted; it only refuses outright what you explicitly told it to refuse via a guard rule.
- **Latency: adds roughly 90-180ms to every Bash command** (p50 ~90-110ms, p95 ~110-180ms depending on system load). Measured directly: an empty Node.js process alone costs ~78-94ms on a typical machine — that's Claude Code's `command`-hook model spawning a fresh process per invocation, with no warm/persistent alternative currently documented. This plugin's own logic adds roughly 11-14ms on top. This is a real, felt delay on every command, not a one-time cost — worth knowing before you install.

## What this does NOT fix

- **AGENTS.md truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug, not something a hook can patch.
- **Rule decay from pure context depth in a session that never compacts.** A 2026-09-22 empirical report on [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) shows even mechanical rules decay continuously with context depth, independent of compaction. v1's `SessionStart` hook only fires on compact/resume, so it won't help a long, never-compacted session. A depth-gated `UserPromptSubmit` trigger is a candidate for v0.2.
- **A small number of narrow false-positive cases remain** (measured, not hypothetical): a risky-sounding phrase used as a filename, git branch name, or npm script name on a command not in the read-only allowlist (e.g. `touch "rm -rf"`, `mkdir git-push-notes`, `git checkout feature/git-push-fix`) will still trigger an "ask." So will a `--help` flag on a risky command (`git push --help`) or risky text inside a `git commit -m "..."` message. These are annoying but rare — 11 cases out of 518 in testing.
- **Two guard-pattern/built-in-list gaps found in testing, not yet fixed**: a user's own guard pattern like `vercel --prod` won't match `vercel deploy --prod` (real CLI usage inserts a word the pattern doesn't expect); and installing from a non-default package index (`pip install --index-url ...`) isn't covered by the built-in list.
- **Opaque wrapper scripts** (`npm run deploy`, `make deploy`, a custom `deploy.py`) are correctly treated as "ask," not silently allowed or blindly denied — but seatbelt can't inspect what they actually do.
- **A regex/heuristic-based matcher, not a real shell parser**: things like command substitution (`$(...)`), variable-hidden command names, or base64-decoded-then-executed strings can genuinely evade detection, since the risky text isn't present as plain text in the command string at all. See `evals/dataset/LABEL_CORRECTIONS.md` for exactly which obfuscation techniques are and aren't caught in practice — several assumed-uncatchable cases turned out to still work because the literal text survives; others (true encoding/computation) don't.
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

## How the accuracy numbers were produced

This isn't self-reported. The full methodology, the 518-row labeled dataset (real commands plus hand-labeled synthetic/adversarial cases), the harness that runs every row through this exact code, and two independent verdicts (an initial one that failed 3 of 4 targets, and a second one after a documented fix pass) are all in the repo:

- [evals/results/VERDICT-2.md](evals/results/VERDICT-2.md) — the current, honest verdict, including a side-by-side comparison with the first attempt and every remaining known failure listed with an example command.
- [evals/results/REPORT.md](evals/results/REPORT.md) — full confusion matrix, per-class precision/recall, and every current failure.
- [evals/dataset/](evals/dataset/) — the dataset itself and the labeling notes, including corrections made after review (with reasons, never silently).
- `node evals/run-classifier-eval.js && node evals/report.js` reproduces the numbers above against the current code.

## Contributing

Issues and PRs welcome. Run `node --test tests/*.test.js` for unit tests and `node evals/run-classifier-eval.js && node evals/report.js` for the full accuracy eval before submitting.

## License

MIT
