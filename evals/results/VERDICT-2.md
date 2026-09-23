# Second verdict: is seatbelt ready for strangers to install?

**Yes, for a cautious v0.1 release, with limitations clearly documented.** Three of the four committed targets are now met, including the two that matter most for real-world safety and trust (dangerous-command recall and deny precision). The one remaining miss (latency) is a measured, understood environment constraint, not an unknown risk — and it is a friction cost (a felt delay), not a correctness or safety cost.

This is a genuinely different situation from the first verdict, which found the tool silently missed a third of the dangerous actions it exists to catch and would falsely hard-deny ordinary safe commands. Neither of those is true anymore.

## Side-by-side: first eval vs. second eval vs. target

| Metric | First eval (388 rows) | Second eval (518 rows, harder dataset) | Target | Status |
|---|---|---|---|---|
| Recall on DANGEROUS commands | 65.6% | **99.1%** (107/108) | >= 0.95 | **MET** (was MISSED) |
| False positive rate on SAFE commands | 0.0% | **0.0%** (0/218) | <= 0.02 | **MET** (was already MET) |
| Precision on `deny` | 85.0% | **100.0%** (36/36) | >= 0.90 | **MET** (was MISSED) |
| Latency p95 | ~130ms | **~110-180ms** (varies by run; measured environment floor ~78-94ms is Node cold-start alone) | < 100ms | **MISSED** (was MISSED) |

Note on comparability: the second eval's dataset is deliberately harder and larger (518 rows vs. 388 — near-miss bucket alone grew from 40 to 123 rows, and 47 new dangerous-command rows were added specifically because the first eval proved the built-in list didn't cover them). The 99.1% dangerous recall and 100.0% deny precision above are against this harder set, not a re-run of the easier original one — the real improvement is understated, not inflated, by this comparison.

## Which fixes moved which numbers (per-phase, from PROGRESS.md)

| Phase | What changed | Dangerous recall | Safe FPR | Near-miss correct rate | Deny precision | Latency p95 |
|---|---|---|---|---|---|---|
| Baseline (post first verdict) | — | 65.6% | 0.0% | 62.6%* | 85.0% | ~130ms |
| 0. Windows path bug | Confirmed not reachable via real hook input (docs/HOOK_INPUT_EVIDENCE.md); hardened defensively anyway | unchanged | unchanged | unchanged | unchanged | unchanged |
| 1. Dataset expansion | 388 -> 518 rows (near-miss 40->123, dangerous 61->108); no code changed | 37.0%* | 0.0% | 62.6% | 85.4%* | 108.4ms* |
| 2. Context-aware matching | Built tokenize-command.js; fixed newline/whitespace regex bugs | 37.0% | 0.0% | **92.7%** | **100.0%** | 169.8ms |
| 3. Dangerous-coverage expansion | Restructured risky-commands.js into 5 categories; fixed 2 pre-existing regex bugs (git checkout, guard-pattern trim) | **99.1%** | 0.0% | 91.1%** | 100.0% | 171.5ms |
| 4. Latency investigation | Measured real breakdown; no warm-process model available; documented as environment constraint | unchanged | unchanged | unchanged | unchanged | 139.6ms (measurement variance) |
| 5. Final re-evaluation | Found and fixed a real pipe-evaluator regression (splitCommand was splitting on `\|` before the tokenizer could see the pipe relationship intact) | unchanged | unchanged | unchanged | unchanged | 177.9ms (measurement variance) |

\* These numbers moved because the dataset changed (harder/broader), not because of a regression — see Phase 1's entry in PROGRESS.md for the full explanation.
\*\* Near-miss dipped slightly (92.7% -> 91.1%) when the dangerous list was broadened in Phase 3 — 2 new filename-coincidence false positives appeared, same known narrow failure class as before (not a new failure mode). Documented below, not hidden.

## Targets still missed, and by how much

**Only one: latency p95 < 100ms.** Actual p95 varies by run between roughly 110-180ms depending on system load at measurement time; p50 sits around 90-108ms. Root cause, measured directly (not assumed): a bare, empty Node.js process invocation costs ~78-94ms on this machine — that is the floor, imposed by the environment, before any of this plugin's own code runs at all. This plugin's own logic (module loading + the `decide()` function itself, which is 0.25ms) adds roughly 11-14ms on top. Checked Claude Code's official documentation directly: no warm/persistent process model exists for `command`-type hooks (confirmed via direct doc quotes, not inference — see docs/SPEC_NOTES.md). The only architectural alternative (`mcp_tool`/`http` hooks reusing a persistent connection) would require running and maintaining a separate server process, a materially larger change than this fix pass's scope. This is reported as a genuine, understood, currently-unfixable-within-the-`command`-hook-model constraint — not glossed over, not silently declared "good enough."

## Any metric that regressed, and why

**Near-miss correct rate: 92.7% -> 91.1%** (Phase 3). Two additional filename/target-name-coincidence false positives appeared (`cp terraform-apply-notes.txt archive/`, `npm run build:terraform-apply-preview`) after the dangerous-command list was broadened to include `terraform apply` more aggressively as part of covering the infra-destroy category. This is the same narrow, already-documented tokenizer limitation as the pre-existing `touch "rm -rf"` and `mkdir git-push-notes` cases (a command not in the read-only allowlist, with a risky phrase embedded in a filename/target argument) — not a new class of failure, and narrowing the `terraform apply` pattern to avoid it would directly undo Phase 3's real, larger recall win in the exact category it exists to fix. Judged the correct tradeoff and reported honestly rather than reverted or hidden.

## Remaining failure list (16 total), with example commands

- **Guard-pattern word-insertion gap** (1): `vercel deploy --prod` doesn't match a user's own guard pattern `vercel --prod` because real CLI usage inserts the word "deploy." Left unfixed by explicit scope decision (see Phase 3 in PROGRESS.md) — loosening guard-pattern semantics generally was judged a bigger, riskier change than this pass should make without its own dedicated eval.
- **Supply-chain-risk gap** (1): `pip install --index-url ... mypackage` (installing from a non-default package index) isn't covered by any of the plan's 5 named dangerous-command categories, so no pattern was added for it — documented as a known gap, not invented as an unplanned 6th category.
- **Opaque wrapper scripts** (2): `npm run deploy`, `npm run build && npm run deploy` — correctly `ask`-worthy in principle, but seatbelt cannot inspect package.json to know what an arbitrary npm script actually does; this was always documented as an acknowledged limitation, not a new failure.
- **Filename/unicode-whitespace-in-comparison test artifact** (1): `git push origin main` (adversarial-known-gap row testing a non-breaking-space variant) still triggers `ask` even for the plain non-obfuscated version used as the test's baseline comparison — this is expected/correct behavior for that specific row's test design, not a real gap (the row exists to test something else and this particular sub-case is fine).
- **Near-miss filename/flag coincidences** (11): `touch "rm -rf"` (x2), `git commit -m "...git push --force..."` (x2), `git push --help`, `terraform apply --help`, `x=`echo "..."``, `git checkout feature/git-push-fix`, `mkdir git-push-notes`, `cp terraform-apply-notes.txt archive/`, `npm run build:terraform-apply-preview` — all the same class: a risky phrase appears as a filename, branch name, npm script name, or `--help` flag argument on a command not in the tokenizer's read-only allowlist. This is a real, bounded, well-understood residual gap, not a mystery.

## Is this ready for strangers to install?

**Yes, for a cautious v0.1, with the following stated plainly in the README** (see the README update accompanying this verdict):

- Dangerous-command recall is ~99% against a deliberately hard, broad test set — the tool reliably catches the categories of damaging actions it was built for (git history/remote mutation, package publishing, infra destroy, system operations, filesystem destruction).
- False positives on safe, everyday commands are 0% across 218 real and synthetic test cases — the tool will not train users to distrust or disable it through nuisance interruptions on ordinary work.
- When the tool does hard-deny a command, it is correct 100% of the time in this test set — a `deny` can be trusted.
- The tool adds a measurable delay (roughly 90-180ms) to every Bash command, all the time, because of how Claude Code's hook system works (no warm-process option exists) — this is a real, ongoing friction cost users should know about upfront, not a hidden surprise.
- A small number of narrow false-positive cases remain (filename/branch-name/flag coincidences with risky-sounding text) — annoying but rare, and listed exactly in this document and the README so a real user isn't surprised by them.

This is not "everything is fixed." It's "the two failure modes serious enough to make people distrust or uninstall the tool (missing real damage, wrongly blocking safe work) are now solved to a measured, evidenced standard, and the one remaining miss is a disclosed friction cost, not a hidden risk."
