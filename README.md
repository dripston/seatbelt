# seatbelt

**Problem:** Claude Code agents follow your CLAUDE.md/AGENTS.md rules at first, then silently drop them — after context compaction, on resume, or just from being deep in a long session.

**What seatbelt does:** keeps your rules alive in the agent's context across three triggers — compaction, resume, and context depth. It does not block or check anything. It reminds; it does not enforce.

## Why the scope changed

seatbelt originally also tried to detect and block dangerous Bash commands (a `PreToolUse` hook with pattern-based and structural detection). Two rounds of real, tested work on that detector found its recall on tools it hadn't seen before was unstable and ecosystem-dependent — 12%, then 60%, then 40% across three independently-built blind tests, with false positives held at 0% throughout. That is not a stable foundation to ship a safety claim on. The enforcement code, its tests, and its full evaluation history are preserved on the `archive/enforcement` branch — nothing was deleted, just cut from what ships. Full reasoning and the numbers: [docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md).

## Install

```bash
# Add this repo as a marketplace source, then install the plugin by name:
claude plugin marketplace add dripston/seatbelt
claude plugin install seatbelt

# Testing from a local clone instead of GitHub (must start with ./ or be absolute):
claude plugin marketplace add ./path/to/local/seatbelt
claude plugin install seatbelt
```

## Write your rules

Add a critical block to `CLAUDE.md`, `.claude/CLAUDE.md`, or `AGENTS.md`:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first.
- Never delete files in migrations/.
- Always run tests before committing.
<!-- /rule-guard:critical -->
```

The marker is optional. If your file has no `<!-- rule-guard:critical -->` block, seatbelt's default (`auto`) mode re-injects the whole file when it's small enough, so you don't have to learn special syntax just to get the benefit. See "Configuration" below.

## The three triggers

1. **Compaction** (`SessionStart`, `source: compact`) — when Claude Code compacts a long session, its own context-compression can drop your rules out of the summary. seatbelt re-reads your rules file and re-injects it right after.
2. **Resume** (`SessionStart`, `source: resume`) — same re-injection when you resume a saved session.
3. **Context depth** (`UserPromptSubmit`) — a session that never compacts can still lose rule adherence purely from being deep in context. seatbelt estimates the current transcript's token depth and re-injects once past a threshold (default: first at 100,000 tokens, then every 50,000 tokens after), independent of compaction. A floor of at least 10 turns between re-injections (configurable) keeps a token-estimation quirk from spamming your context.

Where the depth defaults come from: measured rule-adherence degradation begins around 50K-100K tokens and worsens sharply near 50% of the model's context window (roughly 100K for Claude Code's ~200K window); an existing community context-refresh hook uses 90,000 as its threshold. 100,000 sits at the start of the degradation zone, before the steep part of the drop-off. Full reasoning: [docs/DESIGN.md](docs/DESIGN.md).

## Configuration

Optional `.claude/seatbelt.json` in your project:

```json
{
  "firstFire": 100000,
  "interval": 50000,
  "mode": "auto",
  "maxInjectTokens": 1500,
  "minTurnsBetween": 10
}
```

- `firstFire` / `interval`: token thresholds for the depth trigger (see above).
- `mode`: what gets re-injected —
  - `"auto"` (default): the whole rules file if it fits under `maxInjectTokens`, else the marked critical block if one exists, else the first 40 lines plus a truncation note.
  - `"block"`: only the marked `<!-- rule-guard:critical -->` block. Nothing if no block exists.
  - `"full"`: the entire rules file, regardless of size.
- `maxInjectTokens`: the budget `auto` mode checks against (default 1500, estimated at ~4 characters per token).
- `minTurnsBetween`: minimum turns between depth-triggered re-injections (default 10).

Any missing or invalid field falls back to its default individually — a typo in one field doesn't break the rest of your config.

## What this does NOT do

- **Does not block commands.** There is no `PreToolUse` hook, no deny, no ask. If you need that, see "Why the scope changed" above and the archived branch — but read the numbers first.
- **Does not detect dangerous operations.** seatbelt has no opinion on what's risky. It only keeps whatever you wrote alive in context.
- **Does not replace your own judgment.** A rule that's present in context is a rule the model is more likely to follow, not a guarantee it will.
- **Does not fix AGENTS.md truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug, not something a hook can patch.
- **Adds a small, per-invocation cost.** Every `UserPromptSubmit` reads and size-checks the current transcript (bounded: exact read under 2MB, byte-size estimate above it) and every `SessionStart`/`SessionEnd` does a small filesystem read/write. This is much cheaper than the removed `PreToolUse` hook (which ran on every single Bash command), but it's not free.

## Measured: does re-injection actually help?

A real headless adherence run (`evals/adherence/`) padded a session to 25K-200K tokens and probed 3 mechanically-checkable rules at each depth, with and without seatbelt. The result was a null result on the specific question of measurable improvement — but running it for real surfaced two genuine bugs (one, a wrong JSON nesting level in `session-start.js`, meant `SessionStart` re-injection had been a silent no-op in production before this was caught and fixed) and raised an open question about whether the harness's design (`--resume`-accumulated depth vs. a true `/compact` event) exercises the failure mode seatbelt targets. Full honest writeup, including what the run does and doesn't support: [evals/adherence/RESULTS.md](evals/adherence/RESULTS.md).

## Prior art

[Cozempic](https://github.com/Ruya-AI/cozempic) does `SessionStart`-hook-based rule-freshness reminders as part of a broader context-pruning tool. seatbelt is narrower and single-purpose: three re-injection triggers, no pruning, no other features.

## Evidence for the underlying problem

- [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) — re-injection feature request, citing 7 prior duplicate reports, including a dose-response report showing adherence decaying continuously with context depth, independent of compaction
- [anthropics/claude-code#88565](https://github.com/anthropics/claude-code/issues/88565) — auto mode routes edits through Bash, bypassing path-scoped rule injection
- [anthropics/claude-code#81999](https://github.com/anthropics/claude-code/issues/81999) — agent ignores an explicit "every time, no exceptions" rule after a few approval cycles
- [anthropics/claude-code#34197](https://github.com/anthropics/claude-code/issues/34197), [#43716](https://github.com/anthropics/claude-code/issues/43716) — CLAUDE.md ignored in long sessions

Full evidence log: [docs/EVIDENCE.md](docs/EVIDENCE.md). Design rationale: [docs/DESIGN.md](docs/DESIGN.md).

## Contributing

Issues and PRs welcome. Run `node --test tests/*.test.js` before submitting.

## License

MIT
