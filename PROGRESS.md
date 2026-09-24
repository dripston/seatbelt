# Progress: seatbelt

## Current status (2026-09-25): v0.2.0, re-injection only, works as designed, adherence benefit unconfirmed

seatbelt keeps a project's CLAUDE.md/AGENTS.md rules alive in Claude Code's context across three triggers: compaction, resume, and context depth. It does not detect or block anything.

**What's confirmed working**: all three hooks (`SessionStart`, `UserPromptSubmit`, `SessionEnd`) fire correctly and emit the right JSON shape — verified via live `--debug hooks` traces against the real Claude Code binary, not just unit tests. A real, previously-shipped bug (`session-start.js` emitting `additionalContext` at the wrong JSON nesting level, silently discarded by Claude Code) was found and fixed this way; end-to-end schema tests now guard against it recurring. 90/90 unit tests passing.

**What's not confirmed**: whether re-injection measurably improves rule adherence at depth, compared to not having it. Two real headless adherence test runs (`evals/adherence/RESULTS.md`) both came back null results — not because seatbelt failed, but because neither test's "seatbelt disabled" control arm ever showed rule decay in the first place, so there was nothing for re-injection to visibly fix. This is a limitation of the test design (padding depth via repeated `--resume` calls may not reproduce a real session's internal compaction/attention dynamics), not evidence the mechanism doesn't work. Further test iteration was deliberately stopped here given the cost of a good-faith attempt already made twice — the product ships on the strength of the mechanism and the documented, verified problem it targets, not on a clean adherence number.

## How the project got here

seatbelt originally also included command-level enforcement (a `PreToolUse` hook that could deny/ask on risky Bash commands, built with pattern-based and later structural detection). Two rounds of real, honestly-measured testing found its recall on unfamiliar tools was unstable and ecosystem-dependent (12% → 60% → 40% across three independently-built blind holdout tests, with false positives held at 0% throughout) — not a foundation to ship a safety claim on. That entire feature, its tests, and its full evaluation history (four verdicts, three holdout datasets, per-signal analysis) were cut from `main` and preserved on the `archive/enforcement` branch. Full numbers and reasoning: [docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md).

Every phase of both the original build and the v2 pivot is recorded in detail in git history (`git log`) — each phase is its own commit with a full description of what changed and why. This file intentionally does not duplicate that; it exists to state where the project stands right now.

## Where to look for detail

- **How it works today, what it doesn't do**: [README.md](README.md)
- **Why enforcement was cut, with the full metric history**: [docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md)
- **Design rationale for discovery, content modes, and the depth trigger**: [docs/DESIGN.md](docs/DESIGN.md)
- **The adherence tests, both runs, full data and honest analysis**: [evals/adherence/RESULTS.md](evals/adherence/RESULTS.md)
- **Original problem research and evidence**: [docs/EVIDENCE.md](docs/EVIDENCE.md) (the initial demand-research notes are local-only, not tracked in the repo — see `.gitignore`)
- **The removed enforcement code and its complete eval history**: `archive/enforcement` branch
