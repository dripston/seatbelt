# Per-signal firing table (Phase 2)

Measures each structural-danger signal in ISOLATION against the full 518-row main dataset + the 40-row (burned) first holdout, 558 rows total. "Correct" = the signal fired on a row whose expected label was ask/deny. "Wrongly fired" = the signal fired on a row whose expected label was allow (a false positive for that signal specifically — the final hook decision may still be correct via a different path, e.g. a guard rule, but this isolates each signal's own precision).

| Signal | Total firings | Correct (expected ask/deny) | Wrongly fired (expected allow) | Precision |
|---|---|---|---|---|
| A | 27 | 26 | 1 | 96.3% |
| B | 26 | 24 | 2 | 92.3% |
| C | 14 | 13 | 1 | 92.9% |
| D | 1 | 1 | 0 | 100.0% |
| E | 5 | 5 | 0 | 100.0% |
| F | 6 | 6 | 0 | 100.0% |

## Wrongly-fired examples (up to 5 per signal)

**Signal A:**
- `psql -c "EXPLAIN DELETE FROM users WHERE id = 1;"`

**Signal B:**
- `touch "rm -rf"`
- `touch "rm -rf"`

**Signal C:**
- `stat -c '%s %n' /var/log/shutdown.log`

