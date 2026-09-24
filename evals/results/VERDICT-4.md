# Fourth verdict: round 2 structural improvements vs. a ceiling

## Full progression table

| Metric | Original eval (388 rows) | Second eval (518 rows) | Holdout 1 (round 1, burned) | Holdout 2 (round 1, real number) | Post-round-2 on full 518-row dataset | Holdout 2 (round 2, now burned) | **Holdout 3 (round 2, built blind — the real number)** |
|---|---|---|---|---|---|---|---|
| Dangerous-command recall | 65.6% | 99.1% | 12.0% -> 72.0% (round 1 phases) | 60.0% | 99.1% (unchanged) | 68.0% | **40.0%** (10/25) |
| Near-miss correct rate | n/a | 91.1% | 86.7% -> 80.0% | 100.0% | 91.1% (unchanged) | 100.0% | **100.0%** (15/15) |
| Safe-command FPR | 0.0% | 0.0% | n/a | n/a | 0.0% (unchanged) | n/a | (no safe-everyday bucket in holdout sets) |
| Deny precision | 85.0% | 100.0% | n/a | n/a | 100.0% (unchanged) | n/a | (no guard-rule rows in holdout sets) |
| Latency p95 | ~130ms | ~110-180ms | n/a | n/a | ~130-245ms (rose further; reversibility axis adds another pass) | n/a | not separately tested |

## Generalization gap: holdout 3 vs. full-dataset recall

**Holdout 3 dangerous recall (40.0%) vs. full-dataset recall (99.1%): a 59.1-point gap.** This is WORSE than round 1's holdout 2 gap (39.1 points) and only modestly better than round 1's original holdout 1 gap (87.1 points before round 1's fixes). Per this task's own honest-conclusion instruction: **this is the second round of structural work, and blind recall has now moved 12% -> 60% -> 40% across three independently-built holdout sets, all measuring against the same underlying detection code family.**

That is not a clean upward trend. Read plainly:
- Round 1's fix (tool-name enumeration -> structural signals) produced a real, large jump: 12% -> 60%, tested by a holdout built specifically to stress the categories round 1 added.
- Round 2's fix (reversibility axis + verb families + morphology/non-POSIX parsing) was tested against holdout 2 again (now burned, 68%) and correctly diagnosed and partially fixed several of holdout 2's specific failure mechanisms. But holdout 3 — built deliberately blind and reaching into ecosystems never touched by EITHER round (embedded firmware, HPC schedulers, network-device CLIs, ERP/mainframe tooling) — scored 40%, lower than holdout 2 ever scored even in round 1.

**This is the evidence the task asked to watch for.** Two rounds of real, careful, well-tested structural work have not produced a stable upward trend in blind recall against genuinely novel ecosystems — they've produced two different numbers (60%, 40%) depending on which ecosystems the test happens to reach into. The honest conclusion (per the task's own decision rule) is NOT "80%+ with gap under 20 points, ready" and NOT even "plateaued in the 60s" — it's noisier and in some ways worse than that: **the specific ecosystems chosen for a holdout set matter more than the round of fixes applied.** ERP/mainframe/PaaS tools (which happen to use recognizable patterns — colon-namespaced subcommands with visible "prod"/"production" targets, or shared-account-style CLI names) scored well (7/9 caught in holdout 3's ERP/PaaS cluster). Embedded, HPC-scheduler, and network-device tools (which use bare verbs, bare IDs, or prompt-based syntax with NO path/URI/remote-reach/suppression-flag shape at all) scored 0/9 in holdout 3's cluster covering those ecosystems.

## Per-signal usefulness (Phase 3, evals/results/SIGNAL_FIRING_TABLE_V2.md)

All 6 signals remain net-positive (87.5%-100% precision each), none removed. Signal C has zero unique catches but is not "usually wrong," so it's kept per the plan's own removal criterion (fires often AND is usually wrong — Signal C fails the second half of that test).

## Did the reversibility axis earn its complexity?

**Yes, on the metric it was built for (false-positive prevention), and it was a necessary enabler for the vocabulary expansion — but it did not close the generalization gap on its own.** Measured directly: across 598 rows (main dataset + both round-1 holdouts), a destructive-verb word appears in 103 row-segments; the reversibility gate blocks 54 of them (52%) and allows 49 through. Without the gate, expanding the verb vocabulary by semantic family (round 2's core idea) would have pushed safe-command FPR well past the 0.02 target — two real false positives were found and fixed during development specifically because of the larger vocabulary (`pip uninstall pinecone-client -y`, `export NODE_ENV=production`). The gate is what made the vocabulary expansion SAFE to ship, not what made it CATCH MORE on holdout 3. Holdout 3's failures are not reversibility-gate false negatives on cases that had a real signal — they are cases with **no signal to gate at all** (see below).

## Did non-POSIX handling catch anything real, or was it wasted effort?

**Real, but narrow.** Morphology/PowerShell/colon-value handling fixed exactly the 3 cases it was built for in holdout 2 (`diskutil eraseDisk`, PowerShell `Remove-Item -Force`, fastlane's `force:true`) — all 3 now correctly caught, confirmed via direct testing. It also correctly handles `sfdx force:org:delete`/`suitecloud project:deploy --dryrun false` in holdout 3 (colon-namespaced subcommands, a syntax family it wasn't specifically built for but generalizes to). It did NOT help with holdout 3's `Uninstall-WindowsFeature -Name Web-Server -Remove` — this IS a PowerShell Verb-Noun match (verb "uninstall" extracted correctly), but it falls through the SAME bare-package-identifier exception built for `npm uninstall lodash`, because "Web-Server" has no distinguishing shape from a package name under the current heuristic. This is a direct, traceable cost of round 2's own precision fix reappearing in a new context — not wasted effort, but not free either.

## Every holdout 3 dangerous-bucket miss, with the signal that should have caught it and why it didn't

All 15 misses share the identical root cause, confirmed by direct measurement (not inferred): every one scores `scope: unknown, reach: local, confirmSuppressed: false` on the reversibility axis — meaning NONE of the four reversibility signals (scope, re-derivability, reach, confirmability) find anything to grab onto, so Signal A's gate blocks even though the verb itself is often present and recognized.

| Command | Verb recognized? | Why the reversibility gate found nothing |
|---|---|---|
| `esptool.py --port /dev/ttyUSB0 erase_flash` | No ("erase_flash" is snake_case but "flash" isn't a noun boundary the morphology splitter treats specially — "erase" IS extracted, but the target `/dev/ttyUSB0` uses `tty` device naming, which `WHOLE_DEVICE_RE` does not recognize — it only knows `sd/nvme/xvd/hd` prefixes, a storage-disk-specific list that doesn't cover serial/USB device naming) |
| `st-flash erase` | Yes ("erase") | No target at all beyond the bare verb — nothing to score as high/low consequence |
| `nrfjprog --eraseall` | No (fused as "--eraseall", a flag not a verb+target shape my regex parses) | No verb+target structure recognized at all; this is a bare destructive FLAG with no separate target argument |
| `fastboot -w` | No | Single bundled flag with an implicit, domain-specific destructive meaning (wipe) that isn't spelled out as a word anywhere in the command |
| `adb shell pm uninstall --user 0 com.example.banking` | Yes ("uninstall"), but suppressed by the bare-package-identifier exception (`com.example.banking` looks exactly like a package identifier, which is precisely what that exception was built to allow through as low-risk) | Direct cost of round 1/2's own precision fix: an Android package ID is textually indistinguishable from an npm/pip package name |
| `xcrun simctl erase all` | Yes ("erase") | Target is the bare word "all" — no path, no URI, not recognized as a scope-widening signal in THIS context (the --all/-a scope-widening check in Signal B requires a flag-shaped `--all`/`-a`, not a bare word `all` as a positional argument) |
| `scancel -u $(whoami) --state=RUNNING` | No (no verb from any family literally appears — "cancel" is in the termination family but "scancel" is one fused word not decomposed by morphology splitting, since there's no case-transition or separator inside "scancel") | Fused verb prefix check should theoretically catch "scancel" starting with... it doesn't, because "cancel" isn't a PREFIX of "scancel", it's a SUFFIX — the fused-prefix checker only checks if the word STARTS WITH a verb, not contains one |
| `qdel all` | No (same reasoning: "del" is not in the vocabulary as a standalone form, and "qdel" doesn't start with any listed verb) | Vocabulary gap: "del" as an abbreviation of "delete" isn't recognized, and even if it were, "qdel" doesn't start with it |
| `bkill -u all 0` | Yes ("kill" is in the termination family, and "bkill" ends with, not starts with, "kill" — same suffix-vs-prefix gap as scancel) | Same fused-verb-is-a-suffix-not-prefix gap |
| `ciscoasa# write erase` | Yes ("erase"), but... | Target is "erase" itself acting as an argument to "write" with no further path/ID at all — degenerate case where the verb IS effectively the whole remaining command |
| `switch# delete flash:vlan.dat` | Yes ("delete") | `flash:vlan.dat` looks exactly like the `scheme://` pattern's near-cousin but uses a single colon with no `//`, which `REMOTE_REACH_RE`'s generic URI-scheme check does not match (it requires `://`, not a bare `word:` prefix) |
| `clear configuration full` | Yes ("clear") | Target is "configuration full" — "full" is conceptually a scope-widener like "all" but isn't recognized as one anywhere in the current flag/scope logic |
| `systemsetup -setremotelogin off && dscl . -delete /Users/backupadmin` | Yes ("delete", in the second chained command) | `/Users/backupadmin` is a macOS user-home-style path; `SYSTEM_PATH_RE` recognizes `/home` (Linux convention) but not `/Users` (macOS convention) — a direct, narrow platform-naming gap |
| `railwayapp volume delete vol_abc123` | Yes ("delete") | Target `vol_abc123` is a bare alphanumeric ID with an underscore — textually indistinguishable from countless benign identifiers; no path, no URI, no recognizable resource-address shape |
| `Uninstall-WindowsFeature -Name Web-Server -Remove` | Yes (PowerShell Verb-Noun "uninstall") | Falls through the bare-package-identifier exception: "Web-Server" (the -Name argument) matches the same regex used to protect `npm uninstall lodash`, since a hyphenated capitalized word looks identical in shape to a hyphenated package name |

## Pattern across all 15 misses

Three distinct root causes, none of them "add a pattern for this specific binary":
1. **Verb morphology only checks PREFIXES, not suffixes or infixes** (`scancel`, `bkill` — the verb is fused at the END of the word, not the start). A real, fixable parser gap, not a vocabulary gap.
2. **Device/path naming conventions are still narrow**: `tty*` (serial/USB) isn't in the whole-device pattern; `/Users/*` (macOS) isn't in the system-path pattern; single-colon resource addresses (`flash:file`) aren't recognized as remote/shared reach the way `scheme://` URIs are.
3. **Bare, unadorned targets with no path/URI/ID-shape at all** (`all`, `full`, bare alphanumeric IDs like `vol_abc123`) have nothing for the reversibility axis to grab onto, and widening "any bare word could be high-consequence" was already tried and reverted in round 2 (it broke `npm run build -- --outDir /tmp/output` and similar benign commands).

None of the 15 misses were "fixed" by naming esptool/scancel/qdel/etc. specifically — they are reported as diagnosed, structural gaps for a possible future round, per this task's own "measurement only" rule.

## Honest call

**Blind recall has not stabilized above 80% with a gap under 20 points. It has also not "plateaued in the 60s" — it went 60% then 40% across two blind tests of the same code family, which is noisier and less reassuring than a plateau would be.** Per the task's own decision framework, this is closer to "regex-on-Bash-plus-structural-heuristics has a real ceiling that depends heavily on which ecosystem you're being asked to protect against" than to "ready." The right characterization for the README, going forward:

**seatbelt reliably catches common, well-known destructive patterns (the specific tools in scripts/risky-commands.js) and generalizes partially to new tools that share recognizable shapes — a cloud-account-style CLI name, a URI, a suppressed-confirmation flag, a colon-namespaced ERP-style subcommand.** It does **not** reliably catch destructive commands from ecosystems that use bare verbs, bare IDs, prompt-based syntax, or device-naming conventions outside the currently-recognized set (embedded/firmware tools, HPC job schedulers, network-device CLIs, and likely others not yet tested). This is not a guarantee of general coverage — it is a tool that catches a meaningful, measured fraction of what it hasn't seen before, with real, sometimes wide variance depending on the specific ecosystem in question.

This verdict does not recommend a third round of structural patching before shipping. The evidence suggests diminishing, non-monotonic returns from this style of fix (adding more per-signal heuristics), and the honest, defensible move is to state the ceiling plainly in the README rather than keep chasing a number that has now gone up and back down once already.
