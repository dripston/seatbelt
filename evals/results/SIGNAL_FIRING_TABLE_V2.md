# Per-signal firing table v2 (round 2, Phase 3)

Measured against dataset.jsonl + holdout.jsonl + holdout2.jsonl combined (598 rows). "Unique catch" = this signal fired, no other structural signal fired, AND the enumerated risky-commands.js list also did not fire — i.e. removing this signal would lose this catch entirely.

| Signal | Total firings | Correct (expected ask/deny) | Wrongly fired (expected allow) | Precision | Unique catches |
|---|---|---|---|---|---|
| A | 54 | 54 | 0 | 100.0% | 5 |
| B | 42 | 40 | 2 | 95.2% | 2 |
| C | 47 | 46 | 1 | 97.9% | 0 |
| D | 8 | 7 | 1 | 87.5% | 1 |
| E | 6 | 6 | 0 | 100.0% | 1 |
| F | 9 | 9 | 0 | 100.0% | 1 |

## Wrongly-fired examples (up to 5 per signal)

**Signal B:**
- `touch "rm -rf"`
- `touch "rm -rf"`

**Signal C:**
- `stat -c '%s %n' /var/log/shutdown.log`

**Signal D:**
- `psql -c "EXPLAIN DELETE FROM users WHERE id = 1;"`

## Dead-signal check

No signal fires often AND is usually wrong (the plan's stated criterion for removal) — all 6 signals are between 87.5% and 100% precision. Signal C has 0 unique catches (everything it catches, some other signal or the enumerated list also catches), but it still contributes 46 correct firings at 97.9% precision — "no unique catches" is not the same as "dead weight" per the plan's own removal criterion, so it is kept, not removed.

## Reversibility axis effect (does it reduce FP, increase recall, or both?)

Across all 598 rows, a destructive-verb word (from the expanded semantic-family vocabulary) appears in the real-invocation text of **103** row-segments.
- **49** of those pass the reversibility gate (scored high-consequence) — these are cases where the gate ALLOWS signal A to fire.
- **54** of those are BLOCKED by the gate (verb present, but scored low-consequence) — this is the gate's false-positive-prevention count. Without the gate, a naive "verb alone is enough" design would have flagged all 103, not just 49.

**Conclusion**: the reversibility gate primarily REDUCES false positives (it suppresses 54 verb-present cases that would otherwise fire) while still allowing genuine matches through. Its contribution to RECALL specifically is indirect: by making it safe to include "uninstall"/"remove"/"rm"/"kill" and the expanded semantic-family verbs in the vocabulary at all (round 1 had to exclude "uninstall" entirely to avoid a false positive), the gate is what makes the larger round-2 vocabulary expansion possible without breaking the safe-FPR target. Without the gate, the same vocabulary expansion would have pushed safe FPR well over the 0.02 target (see PROGRESS.md for the specific false positives found and fixed during development, e.g. "pip uninstall pinecone-client -y" and "export NODE_ENV=production").
