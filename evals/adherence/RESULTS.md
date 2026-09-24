# Adherence results v2: does re-injection actually move the curve?

This supersedes the first adherence run. That run's rule set measured nothing — two rules held 100% with seatbelt off (nothing to lose, so no signal) and one rule failed 0% even at turn one with seatbelt on (never followed even fresh, so no baseline to decay from). Neither outcome tells you anything about re-injection.

## The fix: 4 arbitrary rules, verified at baseline before the run

Four rules were chosen with no natural pull either way — the model has no reason to follow or avoid them except being told:

1. **rules-active-footer** — every response must end with the exact line `rules: active`
2. **tmp-prefix-vars** — every code-declared variable must be named with a `tmp_` prefix (only applicable to responses that contain code; scored `n/a` otherwise, excluded from its own rate)
3. **no-bullet-points** — never use bullet points or numbered lists
4. **first-word-so** — every response must begin with `So,`

All 4 were verified to hold on a live probe set at ~45,000 tokens (fresh session, turn one) before this run — 4/4 rules, 4/4 probes. That baseline is not part of the checkpoint data below; it only confirmed there was something real to test.

## Method

Same harness as before, rebuilt: a headless session (`claude -p`, then `--resume`) padded with realistic, topically-unrelated work to 25k/50k/100k/150k/200k token checkpoints. At each checkpoint, 4 generic probes (unrelated to any specific rule — a mix of prose and code requests) were issued, and **each probe's single response was checked against all 4 rules at once**, so a single miss isn't noise: 4 probes × 4 rules = up to 16 data points per checkpoint per condition. Same prompts, same order, in both arms (`seatbelt-enabled`, `seatbelt-disabled`).

**Interruption and resume**: this run hit an API session rate limit mid-way through the `seatbelt-disabled` condition's 200,000-token checkpoint. Rather than discard the 16 already-collected rows (checkpoints 25k-150k, all genuine), `run-adherence.js` was extended with a `--resume-condition` mode that reads the existing raw JSONL, identifies which checkpoints are already complete for a condition, and continues the same session from its last known depth. The resumed run added the remaining 24 rows (disabled's 200k checkpoint, plus the entire `seatbelt-enabled` condition) with no duplicated or skipped checkpoints — verified directly against the raw data (40 rows total, 0 duplicate condition/checkpoint/probe keys, all 5 checkpoints present in both conditions).

## Results

Adherence rate per rule, per checkpoint, per condition (applicable responses only — `tmp-prefix-vars` excludes probes with no code):

| Checkpoint | Rule | seatbelt-disabled | seatbelt-enabled |
|---|---|---|---|
| 25,000 | rules-active-footer | 4/4 | 4/4 |
| 25,000 | tmp-prefix-vars | 1/1 | 1/1 |
| 25,000 | no-bullet-points | 4/4 | 4/4 |
| 25,000 | first-word-so | 4/4 | 4/4 |
| 50,000 | rules-active-footer | 4/4 | 4/4 |
| 50,000 | tmp-prefix-vars | 1/1 | 1/1 |
| 50,000 | no-bullet-points | 4/4 | 4/4 |
| 50,000 | first-word-so | 4/4 | 4/4 |
| 100,000 | rules-active-footer | 4/4 | 4/4 |
| 100,000 | tmp-prefix-vars | 1/1 | 1/1 |
| 100,000 | no-bullet-points | 4/4 | 4/4 |
| 100,000 | first-word-so | 4/4 | 4/4 |
| 150,000 | rules-active-footer | 4/4 | 4/4 |
| 150,000 | tmp-prefix-vars | 1/1 | 1/1 |
| 150,000 | no-bullet-points | 4/4 | 4/4 |
| 150,000 | first-word-so | 4/4 | 4/4 |
| 200,000 | rules-active-footer | 4/4 | 4/4 |
| 200,000 | tmp-prefix-vars | 1/1 | 1/1 |
| 200,000 | no-bullet-points | 4/4 | 4/4 |
| 200,000 | first-word-so | 4/4 | 4/4 |

**Every cell is 100%.** Every rule, every checkpoint, both conditions. Raw data: `evals/results/adherence-raw.jsonl` (40 rows, full response text included for spot-checking).

## Plain answer

**No. Seatbelt showed no measurable adherence improvement over no-seatbelt, at any checkpoint, for any rule, in this run.** There is no hedge in that statement — the data has zero variance to hedge around. This is not a positive result reframed; it is not a negative result either. It is a ceiling effect: adherence did not decay in the `seatbelt-disabled` arm, so there was nothing for the `seatbelt-enabled` arm's re-injection to visibly correct. Comparing two flat 100% lines cannot demonstrate an effect regardless of which mechanism is or isn't running underneath.

## Why the ceiling, and what it does and doesn't tell you

This result should not be read as "the rules never decay, so seatbelt is unnecessary." It should be read as: **this specific harness design — a single long `claude -p --resume` chain accumulating token depth — did not reproduce whatever failure mode motivates seatbelt in the first place.** The GitHub issues this whole project is built on (anthropics/claude-code#92257, #88565, #81999, #34197, #43716) describe rule decay specifically around **context compaction** — the event where Claude Code summarizes and discards raw history — and separately, a dose-response report of adherence degrading with raw context depth even without compaction. Two things are true about this run that may explain the flat result:

1. **`--resume` accumulates depth without necessarily triggering the same internal compaction/attention dynamics as an interactive session that organically fills its context window and compacts.** Each `-p --resume` call is a fresh CLI process reloading the full prior transcript from disk, which is mechanically different from a single long-lived interactive session's internal context management. If real degradation depends on the *model's own attention* thinning out over a session it experiences continuously, a chain of discrete reloads may not reproduce that.
2. **These 4 rules may simply be easy** — a single-line footer, a single first word, avoiding a formatting choice, and a naming convention are all comparatively simple, low-cost instructions to keep satisfying turn after turn, especially when they're freshly present in every single reloaded transcript (CLAUDE.md is loaded fresh by Claude Code's own native mechanism on every process start, independent of seatbelt). A genuinely difficult or easily-forgotten rule — one that competes with the model's own strong defaults, or one several hundred turns removed from being mentioned — might show decay where these did not.

Neither of these is a guess dressed up as a finding — they are stated as open questions this specific harness cannot resolve, not as an excuse for the null result. What can be said with confidence: **this harness, as built, is not sensitive enough to detect an adherence effect one way or the other**, because it produced a ceiling in the very condition (`seatbelt-disabled`) that was supposed to show decay for `seatbelt-enabled` to be compared against.

## What would actually test this

A harness sensitive enough to detect an effect needs a `seatbelt-disabled` arm that visibly fails at some checkpoint — otherwise there is nothing for `seatbelt-enabled` to visibly fix. Candidates for a future attempt, not pursued here given cost/time already spent across two full runs:
- A genuine `/compact` event (not just `--resume`-accumulated depth) — closer to the actual mechanism the underlying GitHub issues describe.
- Harder or more easily-superseded rules — ones that conflict with a strong model default, or ones stated once at the very start of a very long single-context session rather than reloaded fresh every turn.
- A much longer chain (well past 200,000 tokens) if the model or harness can sustain it, in case 200k simply wasn't deep enough for these particular rules.

## Bottom line

Two real adherence runs, two different rule sets, two different null results for two different, both-diagnosed reasons (first run: rules chosen with no baseline to decay from; second run: rules too easy to ever show decay in the control arm). Per the standing instruction for this measurement: report the null result plainly rather than manufacture a number. It is genuinely unknown, after two honest attempts, whether seatbelt's re-injection changes real-world adherence — not because the mechanism was shown not to work, but because neither test constructed a control arm that failed. That is the honest state of the evidence right now.
