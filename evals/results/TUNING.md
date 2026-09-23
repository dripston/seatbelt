# Tuning: sensitivity analysis across risky-command-list strictness

Each configuration run through the real `pre-bash.js` hook via `rule-guard.config.json` override (the plugin's own documented mechanism), against the full 388-row dataset.

| Config | Dangerous recall | Safe FPR | Near-miss FPR | Deny precision |
|---|---|---|---|---|
| STRICT | 91.8% (56/61) | 21.1% (46/218) | 52.5% (21/40) | 87.5% |
| CURRENT (shipped default) | 65.6% (40/61) | 0.0% (0/218) | 47.5% (19/40) | 87.5% |
| LOOSE | 55.7% (34/61) | 0.0% (0/218) | 32.5% (13/40) | 87.5% |

## Reading this table

- **Dangerous recall** should be as high as possible (target >= 95%).
- **Safe FPR** and **near-miss FPR** should be as low as possible (targets <= 2%) — these are the friction/uninstall-risk numbers.
- STRICT is expected to raise dangerous recall at the cost of safe/near-miss FPR (more false alarms on ordinary commands like `git add`, `git commit`, `docker <anything>`).
- LOOSE is expected to lower safe/near-miss FPR at the cost of dangerous recall (misses things like `npm publish`, `kubectl delete`, `dropdb` that CURRENT already misses too, since LOOSE is a subset).

## Recommendation

**CURRENT (the shipped default) is recommended over STRICT and LOOSE**, but with an important caveat.

- STRICT buys +26.2 points of dangerous recall (65.6% -> 91.8%) at a cost of +21.1 points of safe-command false positives (0.0% -> 21.1%). Blocking or interrupting roughly 1 in 5 ordinary commands (`git add`, `git commit`, any `docker` invocation) is well past the uninstall threshold this project set for itself (<=2%). STRICT is not shippable as a default.
- LOOSE buys nothing CURRENT doesn't already have on safe/near-miss FPR (both 0.0% / and LOOSE's near-miss FPR is actually lower, 32.5% vs 47.5%) while giving up 9.9 points of dangerous recall (65.6% -> 55.7%). There is no scenario where LOOSE beats CURRENT on the metric that matters most (dangerous recall) without a corresponding win elsewhere large enough to justify it.
- **CURRENT's real problem is not list strictness — it's the near-miss false-positive rate (47.5%), which is nearly identical across all three configurations (52.5% / 47.5% / 32.5%).** This confirms the near-miss failures are NOT a tuning problem. They come from substring matching without command-structure awareness (matching "git push" inside `echo "..."`, `grep "..."`, `#...` comments, `man git-push`, etc.), which no amount of adjusting WHICH commands are on the risky list will fix. Fixing this requires smarter matching (e.g. checking that the matched text is actually in the command-name position, not inside a string/comment argument), which is a code change, not a config change — logged in DESIGN.md/VERDICT.md as the top priority fix before this ships to strangers.
- Given that, CURRENT should ship as the default, but not before the near-miss precision problem above is addressed — a config change alone (moving between STRICT/CURRENT/LOOSE) cannot fix it.
