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

## Measured accuracy — read this before deciding how much to trust it

**Blind generalization to genuinely new tools has been tested three times, across two rounds of structural improvements, and the result is noisier than a clean success story: 12% -> 60% -> 40%.** It did not climb steadily to a comfortable number and stay there. Full detail: [evals/results/VERDICT-4.md](evals/results/VERDICT-4.md) (the current, most complete verdict — read this one, not the earlier VERDICT-2/VERDICT-3, which are kept for history).

**The honest characterization: seatbelt reliably catches destructive commands from a specific, tested set of tools (see below), and catches a real but inconsistent fraction of commands from tools it hasn't seen — anywhere from ~40% to ~68% depending heavily on which ecosystem is being tested.** It is not a general-purpose guarantee against "dangerous commands" as a category. Treat it as a safety net for known tools with partial, unreliable coverage of the unknown — not as a reason to skip your own judgment on anything unfamiliar.

**Four different dangerous-command-recall numbers exist. All four are published, labeled — not just the best one:**

1. **99.1%** (107/108) against the 518-row training-adjacent dataset — coverage of the *specific commands* the detection logic was built and tuned against (git, npm/yarn/pnpm/cargo/twine/gem, docker push, terraform/kubectl/aws/gcloud/az, and the enumerated system/filesystem commands in `scripts/risky-commands.js`, plus everything `scripts/lib/structural-danger.js`'s 6 signals catch on commands shaped like the ones used to test them). If your workflow stays entirely within well-known, mainstream tools, this is roughly the relevant number.
2. **12.0%** (3/25) — round 1's first blind test, using tools not in the enumerated list (poetry, redis-cli, poweroff, wipefs, rclone, etc.). This motivated moving from an enumerated tool-name list to **structural pattern recognition** — a destructive verb + target, destructive flag combinations, high-risk targets, inline destructive database queries, publish/release argument shapes — rather than memorizing specific binaries.
3. **60.0%** (15/25) — round 1's result, tested blind on a second held-out set (Homebrew, Nix, apk, pacman, PowerShell cmdlets, native Windows CLIs, 3 hypervisors, 3 backup tools, CI/mobile-deployment tools). A real, large improvement over enumeration.
4. **40.0%** (10/25) — **round 2's result, tested blind on a THIRD held-out set** reaching into ecosystems neither round had touched: embedded/firmware flashing tools (esptool, st-flash, nrfjprog), HPC job schedulers (Slurm, PBS/Torque, LSF), network-device CLIs (Cisco IOS/ASA, Juniper JunOS), and ERP/mainframe tooling (Salesforce, NetSuite, Zowe). Round 2 added a reversibility axis (distinguishing "npm uninstall lodash" from "brew uninstall --force x" by consequence, not just verb) and morphology/non-POSIX parsing (camelCase, PowerShell Verb-Noun cmdlets, colon-value flags) — real, tested improvements that fixed the specific cases they targeted — but blind recall on a fresh set of untouched ecosystems came back *lower* than round 1's blind result, not higher.

**Why round 2 didn't extend the round 1 gain**: diagnosed precisely, not guessed (full table in [evals/results/VERDICT-4.md](evals/results/VERDICT-4.md)) — every one of holdout 3's 15 misses shares the same root cause: no positive consequence signal at all. These commands use bare verbs with no separate target (`st-flash erase`), verbs fused as a *suffix* rather than a prefix (`scancel`, `bkill` — the current morphology parser only checks prefixes), device-naming conventions outside the current list (`tty*` serial ports, `/Users/*` on macOS), or bare alphanumeric IDs and words like "all"/"full" with no path/URI/resource-address shape to evaluate. None of these are enumeration-style gaps (no pattern was added for esptool/scancel/qdel specifically) — they're limits of what a regex-and-heuristics approach can infer about consequence when the command gives it nothing structural to work with.

**Near-miss precision is the one number that has held up cleanly across every test**: 100.0% correct on both the second and third blind held-out sets' brand-new trap shapes (read-only subcommands of unfamiliar tools, production-named resources being merely inspected, multi-stage pipe chains, filename coincidences). The structural approach to *precision* (recognizing read-only commands, quoted text, comments — a small set of general rules about command STRUCTURE) transfers far better than the *destructive-detection* side does, which depends more on domain-specific vocabulary and target shape.

**No further structural-patching rounds are planned before shipping.** Two rounds of real, well-tested work have produced a non-monotonic result (60% then 40%), which is evidence of diminishing and unpredictable returns from this style of fix, not evidence that a third round would reliably do better. The honest move, per this project's own decision framework, is to state this ceiling plainly rather than keep iterating toward a number that has already gone up and back down once.

Other measured numbers (against the 518-row training-adjacent dataset):

- **False positives on safe, everyday commands: 0.0%** (0/218) — held at zero through both rounds of structural-detection changes, meaning neither round's expansion of what counts as "dangerous" came at the cost of nagging you during ordinary work.
- **Precision when it hard-denies something: 100.0%** — a `deny` from seatbelt can be trusted; it only refuses outright what you explicitly told it to refuse via a guard rule. Structural detection never emits `deny`, only `ask` — this number and mechanism are unaffected by either round's changes.
- **Latency: adds roughly 90-245ms to every Bash command** (p50 ~90-125ms, p95 ~130-245ms depending on system load and which signals a given command triggers — rose further after round 2 added the reversibility-scoring pass). Measured directly: an empty Node.js process alone costs ~78-94ms on a typical machine — that's Claude Code's `command`-hook model spawning a fresh process per invocation, with no warm/persistent alternative currently documented. This is a real, felt delay on every command, not a one-time cost — worth knowing before you install.

## What this does NOT fix

- **AGENTS.md truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug, not something a hook can patch.
- **Rule decay from pure context depth in a session that never compacts.** A 2026-09-22 empirical report on [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) shows even mechanical rules decay continuously with context depth, independent of compaction. v1's `SessionStart` hook only fires on compact/resume, so it won't help a long, never-compacted session. A depth-gated `UserPromptSubmit` trigger is a candidate for v0.2.
- **A small number of narrow false-positive cases remain** (measured, not hypothetical): a risky-sounding phrase used as a filename, git branch name, or npm script name on a command not in the read-only allowlist (e.g. `touch "rm -rf"`, `mkdir git-push-notes`, `git checkout feature/git-push-fix`) will still trigger an "ask." So will a `--help` flag on a risky command (`git push --help`) or risky text inside a `git commit -m "..."` message. These are annoying but rare — 11 cases out of 518 in testing.
- **Two guard-pattern/built-in-list gaps found in testing, not yet fixed**: a user's own guard pattern like `vercel --prod` won't match `vercel deploy --prod` (real CLI usage inserts a word the pattern doesn't expect); and installing from a non-default package index (`pip install --index-url ...`) isn't covered by the built-in list.
- **Structural danger detection has real, measured blind spots that TWO rounds of fixes have not closed** (see [evals/results/VERDICT-4.md](evals/results/VERDICT-4.md) for every specific case and the full diagnosis): round 1 added structural pattern recognition (verb+target, flags, high-risk targets); round 2 added a consequence-based "reversibility" check and parsing for camelCase/PowerShell/colon-value syntax. Both rounds measurably improved things they specifically targeted, but a third, independently-built blind test (deliberately reaching into embedded/firmware tools, HPC job schedulers, network-device CLIs, and ERP/mainframe tooling) still only caught 40% of dangerous commands — lower than round 1's own blind result. Confirmed root causes: verbs fused as a *suffix* rather than a prefix aren't recognized (`scancel`, `bkill`); device-naming conventions outside `sd/nvme/xvd/hd` (e.g. `tty*` serial ports) and system paths outside `/etc/var/usr/...` (e.g. macOS's `/Users/*`) aren't recognized; and commands with a destructive verb but no path/URI/ID shape at all for the target (`st-flash erase`, `qdel all`) have nothing for the risk-assessment logic to evaluate. This is treated as a real, current ceiling for this detection approach, not a to-do list expected to reach 100%.
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

This isn't self-reported, and it isn't just the numbers that look good. The full methodology, four generations of test data, and four independent verdicts — including two that found the current headline number didn't generalize as well as hoped, one after each of two rounds of fix attempts — are all in the repo:

- [evals/results/VERDICT-4.md](evals/results/VERDICT-4.md) — the current, most complete verdict: the full metric history across every eval and all three held-out generalization tests, a diagnosis of every holdout-3 failure with the specific reason it wasn't caught, an honest assessment of whether round 2's fixes (the reversibility axis, morphology/non-POSIX parsing) earned their complexity, and a plain call that blind recall has not converged to a stable, high number after two rounds of work.
- [evals/results/HOLDOUT_REPORT.md](evals/results/HOLDOUT_REPORT.md), [evals/results/HOLDOUT2_OVERLAP.md](evals/results/HOLDOUT2_OVERLAP.md), [evals/results/HOLDOUT3_OVERLAP.md](evals/results/HOLDOUT3_OVERLAP.md) — the three generalization tests: what each contains, why every row is genuinely novel relative to all prior test data, and exactly what failed.
- [evals/results/SIGNAL_FIRING_TABLE_V2.md](evals/results/SIGNAL_FIRING_TABLE_V2.md) — per-signal precision AND unique-catch counts for each of the 6 structural-detection rules, plus a direct measurement of what the reversibility axis actually buys (mostly false-positive prevention, not recall).
- [evals/results/VERDICT-3.md](evals/results/VERDICT-3.md), [evals/results/VERDICT-2.md](evals/results/VERDICT-2.md), [evals/results/REPORT.md](evals/results/REPORT.md) — prior verdicts and the full confusion matrix, kept for history rather than deleted.
- [evals/dataset/](evals/dataset/) — every dataset (training, holdout 1/2/3) and the labeling notes, including corrections made after review (with reasons, never silently) and an explicit note on which sets are "burned" (used to guide fixes) vs. genuinely blind.
- `node evals/run-classifier-eval.js && node evals/report.js` reproduces the training-adjacent numbers; `node evals/run-holdout3-eval.js` reproduces the current honest generalization number against the current code.

## Contributing

Issues and PRs welcome. Run `node --test tests/*.test.js` for unit tests and `node evals/run-classifier-eval.js && node evals/report.js` for the full accuracy eval before submitting.

## License

MIT
