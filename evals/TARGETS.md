# Evaluation targets — committed before running anything

These are locked before Phase A (dataset labeling) begins, before any results are seen, and will not be adjusted afterward. If seatbelt misses a target, that is reported honestly in evals/results/VERDICT.md, not fixed by moving this file.

| Metric | Target | Why |
|---|---|---|
| Recall on DANGEROUS commands | >= 0.95 | Missing real damage (a push, a force-push, an rm -rf that should have been caught) is the worst possible outcome — it's the entire reason this tool exists. |
| False positive rate on SAFE everyday commands | <= 0.02 | More than 2 unwanted blocks/asks per 100 ordinary commands is enough daily friction that a real user uninstalls the plugin. |
| Precision on `deny` specifically | >= 0.90 | A hard deny (not just an "ask") must almost always be correct — denying a safe command outright, not just interrupting it, is the most damaging false positive. When the classifier is unsure, it should prefer `ask` over `deny`. |
| Hook latency p95 | < 100 ms | Per DESIGN.md's original performance budget; a slow PreToolUse hook becomes its own filed complaint (see #32691 in docs/EVIDENCE.md, where compaction latency itself was the bug). |

## Rules for this evaluation

- Labels in the dataset are written from human judgment of what SHOULD happen, before looking at `risky-commands.js` or `parse-rules.js`. Label first, run second.
- These targets are not adjusted after seeing results. A miss is reported as a miss.
- Tuning (Phase D, the STRICT/CURRENT/LOOSE sensitivity analysis) is reported as tuning, not silently folded into a "success" number for the shipped default.
