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

- **`PreToolUse` hook on Bash**: splits chained commands (`&&`, `;`), runs a lightweight command-structure pass (`scripts/lib/tokenize-command.js`) to tell a real invocation apart from a risky-looking phrase that's just sitting inside a comment, a quoted string, a filename, or a read-only command's arguments (`grep`, `cat`, `echo`, `git log`, etc.) — then checks the real invocation text three ways: against your guarded rules, against a built-in enumerated risky-command list (specific tools — see `scripts/risky-commands.js`), and against **structural danger detection** (`scripts/lib/structural-danger.js`) that recognizes the *shape* of a dangerous command — a destructive verb with a target, destructive flag combinations, high-risk targets, inline destructive database queries, publish/release argument shapes — regardless of which specific tool is being used. A guarded-rule match denies the command and quotes your rule back. Either the enumerated list or structural detection matching with no user guard rule asks for confirmation instead of blocking outright — deny is reserved exclusively for rules you explicitly wrote.
- **`SessionStart` hook**: on `compact` or `resume`, re-reads your critical block and re-injects it as context, so rules don't quietly fall out of the model's effective attention after a summary.
- Both hooks fail open: if parsing crashes or a file is malformed, the hook logs to stderr and allows the action rather than bricking your session, and warns you if a CLAUDE.md/AGENTS.md file exists but no rule block was recognized in it.

## Measured accuracy — headline number is the blind generalization test, not the fitted one

**seatbelt catches ~60% of genuinely novel dangerous commands it was never built or tuned against** (60.0%, 15/25, on a held-out set built blind — see [evals/results/VERDICT-3.md](evals/results/VERDICT-3.md) and [evals/results/HOLDOUT2_OVERLAP.md](evals/results/HOLDOUT2_OVERLAP.md)). This is the number to use when deciding how much to trust it against a tool it hasn't seen before. It is not 99%, and an earlier version of this README said 99% — that number measured something narrower (see below), and leading with it would have been misleading.

**Three different numbers exist for dangerous-command recall. All three are published here, labeled — not just the best one:**

1. **99.1%** (107/108) against the 518-row training-adjacent dataset — measures coverage of the *specific commands* the detection logic was built and tuned against (git, npm/yarn/pnpm/cargo/twine/gem, docker push, terraform/kubectl/aws/gcloud/az, and the enumerated system/filesystem commands in `scripts/risky-commands.js`). If your workflow stays entirely within these tools, this is the relevant number.
2. **12.0%** (3/25) — the first generalization test, using tools not in the enumerated list (poetry, redis-cli, poweroff, wipefs, rclone, etc.). This number is what motivated a rewrite: detection was moved from an enumerated tool-name list to **structural pattern recognition** (`scripts/lib/structural-danger.js`) — recognizing the *shape* of a dangerous command (a destructive verb + target, destructive flag combinations, high-risk targets like raw device paths or production resource names, inline destructive database queries, publish/release argument shapes) rather than memorizing specific binaries.
3. **60.0%** (15/25) — the result of that rewrite, measured on a **second, independently-built held-out set** using tools structural detection had no exposure to at all (Homebrew, Nix, apk, pacman, PowerShell cmdlets, native Windows CLIs, 3 different hypervisors, 3 different backup tools, CI/mobile-deployment tools). This is the honest, current generalization number — a 5x improvement over the enumerated-list approach's 12%, but it does not close the gap fully.

**Why it's 60% and not higher**: every remaining miss falls into one of three understood, documented gaps (full detail and every specific failure in [evals/results/VERDICT-3.md](evals/results/VERDICT-3.md)): (a) the destructive-verb vocabulary is still incomplete (words like "forget," "collect-garbage," or a camelCase-fused verb like "eraseDisk" aren't recognized), (b) non-POSIX flag conventions aren't parsed at all yet (PowerShell's fused verb-noun cmdlets like `Remove-Item`, native Windows `/flag` syntax like `net user x /delete`, colon-value flags like fastlane's `force:true`), and (c) one direct, honest tradeoff — "uninstall" was deliberately removed from the destructive-verb list to stop it firing on routine `npm uninstall <package>`, which also suppressed the genuinely riskier `brew uninstall --force`.

**Near-miss precision generalizes excellently**: 100.0% correct (15/15) on the second held-out set's brand-new trap shapes — read-only subcommands of newly-covered tools, production-named resources being merely inspected rather than acted on, multi-stage pipe chains. The structural approach to precision (recognizing read-only commands, quoted text, comments) transfers far better than the destructive-detection side does.

Other measured numbers (against the 518-row training-adjacent dataset):

- **False positives on safe, everyday commands: 0.0%** (0/218) after the structural-detection rewrite — unchanged from before the rewrite, meaning the new detection logic added zero net regression on ordinary commands, despite catching far more novel dangerous ones.
- **Precision when it hard-denies something: 100.0%** — a `deny` from seatbelt can be trusted; it only refuses outright what you explicitly told it to refuse via a guard rule. Structural detection never emits `deny`, only `ask` — this number and mechanism are completely unaffected by the rewrite.
- **Latency: adds roughly 90-215ms to every Bash command** (p50 ~90-125ms, p95 ~110-215ms depending on system load — rose somewhat after adding structural detection's extra checks). Measured directly: an empty Node.js process alone costs ~78-94ms on a typical machine — that's Claude Code's `command`-hook model spawning a fresh process per invocation, with no warm/persistent alternative currently documented. This is a real, felt delay on every command, not a one-time cost — worth knowing before you install.

## What this does NOT fix

- **AGENTS.md truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug, not something a hook can patch.
- **Rule decay from pure context depth in a session that never compacts.** A 2026-09-22 empirical report on [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) shows even mechanical rules decay continuously with context depth, independent of compaction. v1's `SessionStart` hook only fires on compact/resume, so it won't help a long, never-compacted session. A depth-gated `UserPromptSubmit` trigger is a candidate for v0.2.
- **A small number of narrow false-positive cases remain** (measured, not hypothetical): a risky-sounding phrase used as a filename, git branch name, or npm script name on a command not in the read-only allowlist (e.g. `touch "rm -rf"`, `mkdir git-push-notes`, `git checkout feature/git-push-fix`) will still trigger an "ask." So will a `--help` flag on a risky command (`git push --help`) or risky text inside a `git commit -m "..."` message. These are annoying but rare — 11 cases out of 518 in testing.
- **Two guard-pattern/built-in-list gaps found in testing, not yet fixed**: a user's own guard pattern like `vercel --prod` won't match `vercel deploy --prod` (real CLI usage inserts a word the pattern doesn't expect); and installing from a non-default package index (`pip install --index-url ...`) isn't covered by the built-in list.
- **Structural danger detection has real, measured blind spots** (see [evals/results/VERDICT-3.md](evals/results/VERDICT-3.md) for every specific case): non-POSIX flag conventions aren't parsed yet — PowerShell's fused verb-noun cmdlets (`Remove-Item`, not a bare "remove"), native Windows `/flag` syntax (`net user x /delete`), and colon-value flags (fastlane's `force:true`) all currently evade detection. The destructive-verb vocabulary is incomplete (e.g. "forget," "collect-garbage," or a camelCase-fused verb like `eraseDisk` aren't recognized). And "uninstall" was deliberately removed from the verb list to stop it firing on routine `npm uninstall <package>`, which also means a genuinely riskier `brew uninstall --force` currently isn't caught either — a direct, known tradeoff, not an oversight.
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

This isn't self-reported, and it isn't just the numbers that look good. The full methodology, three generations of test data, and three independent verdicts — including one that found the second verdict's headline number didn't generalize, and a rewrite that only partially fixed it — are all in the repo:

- [evals/results/VERDICT-3.md](evals/results/VERDICT-3.md) — the current, honest verdict: the full metric history across all three evals and two held-out generalization tests, every remaining failure with the specific reason it wasn't caught, and a plain "does this generalize" call using pre-committed thresholds.
- [evals/results/HOLDOUT_REPORT.md](evals/results/HOLDOUT_REPORT.md) / [evals/results/HOLDOUT2_OVERLAP.md](evals/results/HOLDOUT2_OVERLAP.md) — the two generalization tests: what they contain, why each row is genuinely novel relative to the training data, and exactly what failed.
- [evals/results/SIGNAL_FIRING_TABLE.md](evals/results/SIGNAL_FIRING_TABLE.md) — per-signal precision for each of the 6 structural-detection rules, so no single rule is hiding a bad hit rate behind the aggregate number.
- [evals/results/VERDICT-2.md](evals/results/VERDICT-2.md), [evals/results/REPORT.md](evals/results/REPORT.md) — the prior verdict and full confusion matrix, kept for history rather than deleted.
- [evals/dataset/](evals/dataset/) — every dataset (training, holdout 1, holdout 2) and the labeling notes, including corrections made after review (with reasons, never silently) and an explicit note on which sets are "burned" (used to guide fixes) vs. genuinely blind.
- `node evals/run-classifier-eval.js && node evals/report.js` reproduces the training-adjacent numbers; `node evals/run-holdout2-eval.js` reproduces the honest generalization number against the current code.

## Contributing

Issues and PRs welcome. Run `node --test tests/*.test.js` for unit tests and `node evals/run-classifier-eval.js && node evals/report.js` for the full accuracy eval before submitting.

## License

MIT
