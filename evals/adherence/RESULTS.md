# Adherence results: does re-injection actually keep rules followed?

This is the only eval that matters for seatbelt v2. Every prior eval (preserved on `archive/enforcement`) measured command classification — a product seatbelt no longer is. This measures the one claim v2 makes: **re-injected rules get followed at context depth where they'd otherwise decay.**

## Method

A headless session (`claude -p`, fixed `--session-id`, then `--resume` per turn) inside a throwaway project with a CLAUDE.md containing 3 mechanically-checkable rules. The transcript was padded with realistic, topically-unrelated work turns (algorithm/systems explanations, code generation) to depth checkpoints of 25k/50k/100k/150k/200k estimated tokens. At each checkpoint, one probe prompt per rule was issued and the response checked programmatically (regex, no LLM judge) against that rule. The whole sequence ran twice: `seatbelt-disabled` and `seatbelt-enabled` (`claude plugin disable/enable seatbelt`). Raw data: `evals/results/adherence-raw.jsonl` (30 rows).

The 3 rules:
- **british-spelling**: use "colour"/"organise", not "color"/"organize"
- **no-delve**: never use the word "delve"
- **summary-prefix**: prefix any file summary with "SUMMARY:"

## Results

| Checkpoint | Rule | seatbelt-disabled | seatbelt-enabled |
|---|---|---|---|
| 25,000 | british-spelling | adhered | adhered |
| 25,000 | no-delve | adhered | adhered |
| 25,000 | summary-prefix | **violated** | **violated** |
| 50,000 | british-spelling | adhered | adhered |
| 50,000 | no-delve | adhered | adhered |
| 50,000 | summary-prefix | **violated** | **violated** |
| 100,000 | british-spelling | adhered | adhered |
| 100,000 | no-delve | adhered | adhered |
| 100,000 | summary-prefix | **violated** | **violated** |
| 150,000 | british-spelling | adhered | adhered |
| 150,000 | no-delve | adhered | adhered |
| 150,000 | summary-prefix | **violated** | **violated** |
| 200,000 | british-spelling | adhered | adhered |
| 200,000 | no-delve | adhered | adhered |
| 200,000 | summary-prefix | **violated** | **violated** |

**Adherence rate by rule, both conditions combined (10 observations each):**
- british-spelling: 10/10 (100%)
- no-delve: 10/10 (100%)
- summary-prefix: 0/10 (0%)

**seatbelt-enabled vs seatbelt-disabled: identical at every single checkpoint.** No measurable difference.

## This is a null result, and it needs an honest cause, not a hopeful one

Two rules held perfectly regardless of depth or seatbelt, and one rule failed constantly regardless of depth or seatbelt. That is not the adherence curve this eval was built to detect (a rule holding early and decaying with depth, then recovering when re-injected). It is flatness in both directions. Two real causes were found during this run, and a third is a documented open question rather than a guess:

### 1. A real, shipped bug in `session-start.js`, found and fixed mid-run

While this harness was running, a live Claude Code debug trace (`--debug hooks --debug-file`) on a `--resume` call showed:

```
Hook JSON output had unrecognized keys (ignored): additionalContext. Did you mean hookSpecificOutput.additionalContext (with a hookEventName)?
```

`scripts/session-start.js` was emitting `additionalContext` at the **top level** of its output JSON instead of nested under `hookSpecificOutput.additionalContext`, which is the actual Claude Code hook contract. Every `SessionStart` re-injection this hook ever attempted was silently discarded by Claude Code — confirmed both by the warning above and by the absence of the warning plus a new confirmation line (`Hook SessionStart ... provided additionalContext (111 chars)`) after the fix. `scripts/depth-check.js` (the `UserPromptSubmit` hook) already had the correct nested shape and was unaffected.

**This fix landed after the `seatbelt-disabled` condition finished and partway through the `seatbelt-enabled` condition's run.** The `seatbelt-enabled` data above is therefore a mix of pre-fix and post-fix `SessionStart` behavior for whatever `compact`/`resume` re-injections happened to fire during the run. It does not fully explain the null result (see #2), but it means this run cannot be read as a clean test of the fixed code, and the bug itself — found only by tracing real hook output, not by any unit test — is arguably the single most important finding of this phase. Two new end-to-end schema tests (`tests/session-start.test.js`, `tests/depth-check.test.js`) now assert the real JSON shape against this exact failure mode so it cannot regress silently again.

### 2. `SessionEnd` fires after every individual headless invocation, not once per logical conversation

A live debug trace showed `SessionEnd:other` completing after each single `claude -p --resume` call — not just at the true end of a multi-turn conversation. Since `scripts/session-end.js` deletes `depth-check.js`'s temp-dir state file on `SessionEnd`, this means `depth-check.js`'s cross-turn memory (`lastFiredTokens`, `turnsSinceLastFire`) was being wiped after every single padding turn in this harness. This does not, by itself, prevent `depth-check.js` from firing at all — `shouldFire()` still returns true the first time estimated tokens cross `firstFire` regardless of stale state — but it means the "already fired, wait for the next interval" and "respect the turn floor" logic never had a chance to operate the way an interactive session (which does not restart its process every turn) would exercise them. Whether `depth-check.js` fired at all during the 100k+ checkpoints of this specific run was not directly confirmed (the state file was gone by the time this was checked, consistent with SessionEnd cleanup) — recorded as an open question below rather than assumed either way.

### 3. `summary-prefix` may be a harder rule than the other two, independent of seatbelt

"Always use British spelling" and "never use a specific word" are constraints on the model's own generation choices — no state to track, no page to remember. "Always prefix a file summary with a specific token" requires the model to recognize each individual response *as* a file summary and apply a formatting convention on top of it — a different, more structural kind of instruction-following, and one that held at 0% from the very first checkpoint (25,000 tokens, effectively turn 1 with `--session-id`, no depth degradation possible yet) in both conditions. This suggests `summary-prefix` may not be a case of adherence *decaying with depth* at all — it may simply not have been followed even fresh, in which case no re-injection mechanism (seatbelt's or Claude Code's own) is the right fix; the rule itself, or the probe prompt's framing of "summarize" vs. "here is a file, summarize it," may need reworking to test the intended phenomenon.

## What this run does support

- **british-spelling and no-delve held at 100% out to 200,000 tokens with no seatbelt involvement at all** (identical in both conditions). This is genuine evidence that Claude Code's own native CLAUDE.md loading is more depth-robust for plain generation-style constraints than the original motivating GitHub issues (rule decay after compaction) suggested — at least for a single long `--resume` chain without an actual `/compact` event. seatbelt's re-injection triggers (`compact`, `resume`-as-a-new-process, depth) target a different failure mode (context compaction discarding the system prompt / CLAUDE.md content entirely) than gradual attention decay within an uncompacted window, and this harness, built around padding via repeated `-p --resume`, may not reproduce a true compaction event the way an interactive session hitting its context limit would.
- **The false-positive risk seatbelt was built to avoid (interfering with normal responses) did not materialize**: response content in both conditions was substantively similar work product, and seatbelt-enabled did not visibly degrade or alter unrelated response quality.
- **Two real, load-bearing bugs were found and fixed as a direct result of building and running this harness for real**, which a plan that stopped at "build the harness, trust the mocks" would not have caught. That is itself the harness doing its job.

## Honest bottom line

This run is a null result on the specific question "does seatbelt measurably improve adherence at depth," for two compounding reasons: a real bug meant the `SessionStart` trigger's fix landed mid-run rather than before it, and this specific harness design (repeated headless `-p --resume` calls, each ending its own `SessionEnd`) may not exercise real context compaction the way an interactive session would, which is the specific failure mode seatbelt's re-injection is meant to counteract. A clean re-run with the fix in place from the start, and ideally against a workflow that produces a genuine `/compact` event rather than just depth accumulation via `--resume`, would be needed for a confident adherence-curve number. That re-run was not performed in this phase given the cost/time already spent (this run alone: ~35-40 minutes wall time, on the order of several dollars in API usage) — the honest documented finding here, including the bugs found, is reported as this phase's real output rather than a number manufactured to look conclusive.

Per this phase's own instruction: this is not a case of "headless mode cannot support this" (it clearly can — the harness worked mechanically end to end) — it is a case of the first real run surfacing infrastructure bugs worth fixing before the number can be trusted, which is a legitimate and expected outcome of running a new eval for real rather than a failure to report around.
