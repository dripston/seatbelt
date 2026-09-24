# Architecture decision: enforcement cut, seatbelt is re-injection only

## Decision

seatbelt no longer tries to detect or block dangerous commands. It has one job: keep the user's own CLAUDE.md/AGENTS.md rules alive in the agent's context across compaction, resume, and context depth. The `PreToolUse` danger-detection hook, the enumerated risky-command list, the structural detection signals, the reversibility axis, and every eval built to measure them are removed from `main` and preserved on the `archive/enforcement` branch.

## Why

The enforcement side of seatbelt was built in two rounds, each with real unit-test coverage, an honest independently-labeled evaluation, and a documented decision rule for when to stop. Both rounds converged on the same finding: **the detector's recall on unseen tools is not just below-target, it is unstable in a way that more structural work does not fix.**

The numbers, in order:

| What was measured | Dangerous-command recall |
|---|---|
| Original hand-written eval (circular — built from the same spec as the code) | 65.6% |
| Rebuilt eval after the fix pass, same dataset the code was tuned against | 99.1% |
| First blind holdout (tool-name enumeration, before structural detection) | 12.0% |
| Second blind holdout, after round 1 (enumeration replaced with 6 structural signals) | 60.0% |
| Same second holdout, after round 2 (reversibility axis, verb families, non-POSIX parsing) | 68.0% |
| Third blind holdout, built fresh after round 2, reaching into ecosystems neither round touched (embedded firmware, HPC schedulers, network-device CLIs, ERP/mainframe tooling) | **40.0%** |

99.1% was never a real number — it measures memorization of the exact dataset the detector was tuned against, not generalization. The three genuinely blind numbers are 12%, 60%, 40%. That is not a curve converging upward; it is noise that depends more on which ecosystem the holdout set happens to sample than on which round of fixes was applied. Full diagnosis of all 15 third-holdout misses is preserved in `archive/enforcement` at `evals/results/VERDICT-4.md` — the pattern across every miss was the same: bare verbs, bare IDs, or device/path-naming conventions (`tty*`, `/Users/*`, fused-suffix verbs like `scancel`/`bkill`) that the reversibility axis has no signal to grab onto. None of the fixes tried were "add a pattern for this specific binary" — they were structural, and they still didn't produce a stable trend.

Meanwhile the false-positive side worked well throughout: safe-command false-positive rate held at 0.0% and deny precision at or above 85-100% through every round. The problem was never noisy blocking of safe commands. It was that regex-and-heuristics-on-Bash cannot reliably tell a genuinely novel dangerous command from a genuinely novel safe one, because the two look the same from the outside: an unfamiliar verb acting on an unfamiliar target.

Two rounds of careful, tested, honestly-measured structural work is enough evidence that this is a ceiling, not a bug. Continuing to chase it would mean either accepting a tool that silently under-protects on anything outside its enumerated experience (the exact failure mode this project exists to prevent — see the original motivating GitHub issues on rule decay), or over-broadening detection until it produces the false positives that make users disable the tool. Neither is worth shipping.

## What seatbelt actually is now

The part of this project that never had a generalization problem was rule discovery and re-injection: `parse-rules.js` reads CLAUDE.md/AGENTS.md, extracts the critical-rules block, and `session-start.js` re-injects it into context on compact/resume. That's a deterministic, correctness-testable operation with no classification judgment involved — either the rule text made it back into context or it didn't.

seatbelt's new scope: keep the user's own stated rules present in context at points where Claude Code's own behavior (compaction, resume, long-session depth) tends to let them silently drop out. It does not decide what is dangerous. It does not block anything. The user's rules and their guard patterns remain exactly as informative as the user wrote them — seatbelt's job is only that the agent keeps seeing them.

## Where the old code lives

Everything removed from `main` is preserved on `archive/enforcement`, created from the commit immediately before this cut (`4e4f810`, "Round 2 Phase 5: VERDICT-4.md..."). That branch has the full `PreToolUse` hook, the tokenizer, the 6-signal structural detector, the reversibility axis, all three holdout datasets, and every verdict document (`VERDICT.md` through `VERDICT-4.md`) with the complete history of how each number was produced. If tool-name/pattern-based command blocking is revisited later, that work does not need to be redone from scratch — but it should not be re-shipped without first deciding what changed about the generalization ceiling documented here.
