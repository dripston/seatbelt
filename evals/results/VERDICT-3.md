# Third verdict: structural detection vs. tool-name enumeration

## Full metric history

| Metric | Original eval (388 rows) | Second eval (518 rows) | Holdout 1 (pre-rewrite, enumeration only) | Post-rewrite on full 518-row dataset | **Holdout 2 (built blind, the real number)** |
|---|---|---|---|---|---|
| Dangerous-command recall | 65.6% | 99.1% | **12.0%** | 99.1% (unchanged) | **60.0%** (15/25) |
| Near-miss correct rate | n/a | 91.1% | 86.7% | 91.1% (unchanged) | **100.0%** (15/15) |
| Safe-command FPR | 0.0% | 0.0% | (not separately tested) | 0.0% (unchanged) | (no separate safe-everyday bucket in holdout sets; near-miss is the closest proxy and it's 100%) |
| Deny precision | 85.0% | 100.0% | (not separately tested) | 100.0% (unchanged) | (not separately tested — holdout sets contain no guard-rule rows) |
| Latency p95 | ~130ms | ~110-180ms | n/a | ~200ms (rose further with structural detection added) | not separately tested |

## Generalization gap: the actual test this task asked for

**Holdout 2 dangerous recall (60.0%) vs. full-dataset dangerous recall (99.1%): a 39.1-point gap.**

Per the task's own thresholds: under 10 points would mean the structural approach works cleanly; over 20 points would mean it does not. **39.1 points is past the "does not work cleanly" threshold, but it is a dramatically smaller gap than the original enumeration approach's gap (99.1% - 12.0% = 87.1 points).** The honest characterization: structural detection is a real, substantial improvement over enumeration — it moved genuinely blind dangerous recall from 12% to 60%, a 5x improvement — but it does not fully solve generalization. It reduced the failure rate, it did not eliminate it.

## Why the gap remains this large: every holdout 2 failure, with the signal that should have caught it and why it didn't

| Command | Signal that should apply | Why it didn't fire |
|---|---|---|
| `brew uninstall --force postgresql@14` | A (destructive verb + target) | "uninstall" was deliberately removed from the verb list during Phase 1 to fix a false positive on `npm uninstall lodash` (a routine, reversible action). That fix was correct for npm but too broad — `brew uninstall --force` is a genuinely different risk level (force-skips dependency safety checks) that the same verb-removal accidentally also suppressed. A real, direct cost of an earlier precision fix. |
| `nix-collect-garbage -d` | A | "collect-garbage" is not a synonym recognized by the destructive-verb list (delete/destroy/drop/purge/prune/wipe/flush/erase/truncate/revoke/terminate/teardown). A genuine vocabulary gap — this IS a form of "prune," conceptually, but the word itself doesn't appear. |
| `pacman -Rns --noconfirm linux-headers` | A or B | `-R` (remove) is Arch's single-letter flag convention, not a word the verb regex looks for, and `-Rns` bundles three single-letter flags together in one token, which none of the signals parse apart. A genuine syntax-convention gap (bundled single-letter Unix flags). |
| `diskutil eraseDisk APFS Untitled disk2` | A | "erase" IS in the verb list, but the actual token is `eraseDisk` (camelCase, no space) — the verb regex requires a word-boundary-delimited "erase" as its own word, and camelCase fusion defeats that. A tokenization gap, not a vocabulary gap. |
| `tmutil deletelocalsnapshots 2026-01-01-120000` | A | Same camelCase-style fusion problem: "delete" is in the verb list, but "deletelocalsnapshots" is one unbroken lowercase token with no word boundary after "delete" for the regex to anchor on. |
| `Remove-Item -Path C:\...\ -Recurse -Force` | A or B | PowerShell's cmdlet naming fuses the verb into the head command itself (`remove-item`, extracted as a single token by `extractHeadCommand`), so the bare word "remove" never appears as a separate matchable word in the argument text the way it does in Unix commands. PowerShell's whole verb-noun convention is structurally different from POSIX argv parsing, and neither signal A's verb search nor signal B's flag checks were designed with a fused verb-in-head-command shape in mind. |
| `docker-compose down -v --remove-orphans` | B (destructive flags) | "-v" as a bare single-character flag isn't recognized as volume-deletion-equivalent to "--recursive," and "--remove-orphans" contains "remove" but as part of a compound flag name, not a bare destructive-verb word Signal A looks for in the command body. |
| `restic forget --keep-last 0 --prune` | A or B | "forget" is a backup-tool-specific synonym for delete/expire not on the verb list; "--prune" IS recognized by signal B's prune-with-tool-name check, but that check requires the tool name to be git/npm/docker/helm specifically — restic was never added to that allowlist (the fix-pass didn't anticipate a 6th backup tool needing --prune support). |
| `net user backup_svc /delete` | A or B | Windows' `/delete` flag syntax (forward slash, not `--` or `-`) is not recognized by any flag pattern, all of which assume Unix-style dash-prefixed flags. A genuine, structural gap for native Windows CLI conventions (`net`, `sc.exe`, and likely other `net.exe`-family tools). |
| `fastlane run reset_git_repo skip_clean:false force:true` | A | "reset" appears as part of the compound identifier "reset_git_repo" (underscore-joined), and while `\breset\b` should technically match at an underscore boundary in most regex engines, empirically it did not fire here — combined with fastlane's colon-value flag syntax (`skip_clean:false`, `force:true`) which no signal was built to parse at all. A structurally novel flag convention this project hadn't seen. |

**Pattern across all 10 failures**: none are the "same mistake" the task explicitly forbade (adding a pattern for one of these 10 specific strings). They cluster into three real, distinct structural gaps: (1) verb vocabulary is still incomplete (collect-garbage, forget, erase-as-camelCase), (2) non-POSIX flag conventions aren't parsed at all (PowerShell's fused verb-noun cmdlets, Windows' `/flag` syntax, fastlane's `key:value` syntax), and (3) one direct, honest regression from an earlier necessary precision fix (uninstall).

## Per-signal usefulness table (from Phase 2, evals/results/SIGNAL_FIRING_TABLE.md)

| Signal | Total firings (across 558 rows: main dataset + burned holdout 1) | Correct | Wrongly fired | Precision |
|---|---|---|---|---|
| A (destructive verb + target) | 27 | 26 | 1 | 96.3% |
| B (destructive flags) | 26 | 24 | 2 | 92.3% |
| C (high-risk targets) | 14 | 13 | 1 | 92.9% |
| D (inline destructive query) | 1 | 1 | 0 | 100.0% |
| E (publish/release shape) | 5 | 5 | 0 | 100.0% |
| F (irreducible list) | 6 | 6 | 0 | 100.0% |

No signal fires often and is usually wrong — all 6 are net-positive contributors, none needed to be dropped. This table does not include holdout 2's firings (holdout 2 was built and run after this table, per the plan's phase ordering) — the honest reading is that these precision numbers hold on data the signals had some indirect exposure to (via Phase 1/2's iterative fixing against the main dataset and burned holdout), and holdout 2's near-miss result (100% correct, zero false positives) suggests precision generalizes at least as well as these numbers suggest, even though the numbers themselves weren't recomputed on holdout 2 specifically.

## Did safe FPR and deny precision survive the rewrite?

**Yes, on the metrics that could be measured.** Safe-everyday FPR on the main 518-row dataset stayed at 0.0% after all Phase 1 fixes (it briefly rose to 1.8% mid-fix, before the `git rm --cached`, `export NODE_ENV`, and other false positives were fixed — see PROGRESS.md for the specific bugs found and fixed). Deny precision stayed at 100.0% throughout, since structural detection only ever emits `ask`, never `deny` — the deny path is untouched and still gated exclusively behind a user's own guard-tagged rule. Neither holdout set contains guard-rule rows, so deny precision wasn't separately re-measured there, but there is no mechanism by which structural detection could affect it (they are fully independent code paths in `pre-bash.js`).

## Plain yes or no: ready for strangers to install?

**Conditionally yes, with the headline claim now anchored to the honest, blind number (60%), not the fitted one (99.1%).** This is a genuine, evidenced improvement over both the original tool-enumeration approach (which measured 12% on unseen tools) and over shipping nothing — 60% blind recall against a genuinely adversarial, wide-ranging test set (BSD/macOS tools, Windows-native CLIs, 4 different package managers, 3 different hypervisors, 3 different backup tools, CI/mobile-deployment tools) is real protection, not a rounding error. It is not "reliably catches dangerous commands in general" — regex-on-Bash without deep per-ecosystem knowledge cannot fully close this gap, and the honest expectation going forward is that new tools, new flag conventions (Windows `/flag`, PowerShell cmdlets, colon-value syntax), and new verb vocabulary will continue to slip through at a real, non-trivial rate.

**A tool that reliably catches the common cases and says so is still useful. A tool that claims general coverage it does not have is not.** This verdict, and the README update accompanying it, lead with 60% as the headline generalization number, not 99.1% — the fitted number is still shown, labeled, for readers who want to understand what it actually measures (coverage of the specific tools already enumerated), but it is not the number a user should use to decide how much to trust this tool against a tool it hasn't seen before.
