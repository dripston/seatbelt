# Evidence: the rule-decay problem is real, unfixed, and not fully covered by existing tools

All issues verified directly via `gh issue view` on 2026-09-22 (not taken on faith from prior research summaries).

## Core issues

| Issue | Title | State | Created | Closed | Close reason |
|---|---|---|---|---|---|
| [#92257](https://github.com/anthropics/claude-code/issues/92257) | Re-inject user-marked critical rules before each turn — gating rules decay between turns while format rules hold | OPEN | 2026-09-05 | — | — |
| [#88565](https://github.com/anthropics/claude-code/issues/88565) | Auto mode silently disables path-scoped rules: Bash edits never trigger rule injection | OPEN | 2026-08-21 | — | — |
| [#81999](https://github.com/anthropics/claude-code/issues/81999) | Claude Code ignores CLAUDE.md git commit/push restriction after initial compliance | CLOSED | 2026-07-28 | 2026-09-06 | `NOT_PLANNED` — auto-closed by github-actions bot for inactivity. **Not resolved, not fixed.** |
| [#34197](https://github.com/anthropics/claude-code/issues/34197) | Claude Code continually ignores CLAUDE.MD file | CLOSED | 2026-03-13 | 2026-05-26 | Auto-closed as duplicate of #19635, #33603, #33878. **Not resolved, not fixed** — duplicates exist and were also not fixed. |
| [#43716](https://github.com/anthropics/claude-code/issues/43716) | Opus 4.6 (1M): Ignores CLAUDE.md rules in long sessions | CLOSED | 2026-04-05 | 2026-06-01 | `NOT_PLANNED` — inactivity auto-close. **Not resolved, not fixed.** |

**Conclusion: no official fix has shipped.** All closures are stale-bot housekeeping, not engineering resolutions. This confirms the plugin is not pointless — the STOP condition in Phase 0 does not trigger.

## #92257 thread — active, high-quality, ongoing as of today

This issue has real technical engagement in progress (comments dated 2026-09-06 and 2026-09-22, the same day as this build):

- User `stonianua` distinguishes "gating rules" (decay fast) from "format rules" (hold longer, checkable externally).
- User `bragboy` posted a rigorous empirical analysis: a session with **zero compaction events**, 2095 events over 4 days, where a pure mechanical rule ("never use em-dashes") held perfectly for the first 59 assistant messages then broke 159 times as context depth grew — a continuous dose-response curve (0 → 1.80 → 2.77 violations/1k chars across quintiles), not a discrete drop-off.
- **Key implication for this design**: rule decay is not solely a compaction event — it is also a continuous function of context depth within a single uncompacted session. A `SessionStart` hook that only fires on `compact`/`resume`/`startup` (as in this plan's Phase 4) will **not** catch bragboy's failure mode. Logged as a known limitation / v0.2 candidate: a depth-gated `UserPromptSubmit` trigger, which bragboy measured at ~0.18% token overhead when threshold-gated.
- bragboy's comment also notes: "compaction appears to mask this... sessions that compact regularly keep getting the rule re-inserted for free" — meaning SessionStart-only re-injection is a reasonable v1 approximation, but not a full fix.

## Competing/adjacent tools found

### Cozempic (github.com/Ruya-AI/cozempic, pip package)
- Claims 100,000+ users (self-reported badge, not independently verified — treat skeptically, but it is a real, actively maintained project at v1.8.39, not a dead repo).
- Runs a `SessionStart`-hook-based "guard daemon" that does context pruning (18 strategies) and keeps CLAUDE.md-style rules fresh via periodic reminders as a side effect of its pruning/context-management focus.
- **Does not appear to do command-level PreToolUse enforcement** (deny/ask decisions on specific risky commands like `git push --force`, `rm -rf`, deploy commands, matched against user-authored rules). Its focus is context bloat removal, not action-gating.
- **Implication**: rule-guard's differentiation is not "we re-inject rules" (Cozempic already claims to do a version of this at real scale) — it is **deterministic, command-level guarding of risky actions against user-defined critical rules via PreToolUse**. This must be stated honestly in the README rather than claiming to be first-to-market on rule re-injection generally.

## Bottom line

- The underlying problem (rule decay) is real, verified via primary sources (not secondhand agent summaries), unresolved by Anthropic, and actively being discussed by technically sophisticated users as of the day of this build.
- A more mature competitor than initially known exists (Cozempic) but does not cover the PreToolUse command-gating mechanism, which remains the differentiated core of this plugin.
- v1 scope (SessionStart re-injection + PreToolUse guarding) is justified, with the depth-gated re-injection gap explicitly logged as a known limitation, not silently ignored.
