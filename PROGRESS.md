# Progress: seatbelt build

## Status: build complete (9 phases); eval rebuild complete (5 phases, verdict: not ready); fix pass in progress

## Fix pass: phase-by-phase (this section updated as each phase completes)

| Phase | Status | Dangerous recall | Safe FPR | Near-miss FPR | Deny precision | Latency p95 | Notes |
|---|---|---|---|---|---|---|---|
| Baseline (post eval-rebuild, pre-fix) | — | 65.6% | 0.0% | 47.5% | 85.0% | ~130ms | From evals/results/VERDICT.md |
| 0. Windows path bug | Done | 65.6% | 0.0% | 47.5% | 85.0% (unchanged — targets a path not exercised by the dataset) | ~130ms | See docs/HOOK_INPUT_EVIDENCE.md: captured 4 real hook-input samples from a live session. **Finding: Claude Code always sends `cwd` in native Windows format (`D:\\skill`), even inside Git Bash where the shell itself uses POSIX-style paths.** The POSIX-path bug in `findAndParseRules`/`loadConfiguredRisky` is real but NOT reachable via real Claude Code hook input in this configuration. Hardened defensively anyway: added `normalizeCwd()` in scripts/lib/parse-rules.js, converting Git-Bash/MSYS-style mount paths (`/d/foo`) to native Windows form (`D:\foo`) on win32 before any `path.join` call, wired into both `findAndParseRules` and `loadConfiguredRisky`. Added a startup sanity-check warning to stderr when a CLAUDE.md/AGENTS.md file exists but no critical block was recognized in it (silent no-op is the worst failure mode). 10 new unit tests in tests/normalize-cwd.test.js, covering `/d/foo`, `D:\foo`, `D:/foo`, UNC paths, relative paths, and an end-to-end POSIX-cwd rule-discovery case — all confirmed passing against the fix (44/44 total unit tests pass). Full eval re-run: numbers unchanged from baseline, as expected, since no dataset row exercises this code path — confirms no regression. |
| 1. Dataset expansion | Done | 37.0% (108 dangerous rows, up from 61) | 0.0% (218 rows, unchanged) | new baseline: 62.6% correct (46 failures, 123 rows, up from 40) | 85.4% (unchanged — no matching-logic touched yet) | 108.4ms | Dataset expanded from 388 to 518 rows: near-miss 40->123 (new categories: read-only commands with risky args, quoted/heredoc/comment text, filename/branch-name coincidences, editors opening risky files, innocuous scripts with risky-sounding names, writing risky text to a file), dangerous-builtin 50->97 (+47 rows drawn directly from the original REPORT.md miss list plus close variants, per the plan's anti-lookup-table instruction). All numbers moved because the dataset is now harder and broader, exactly as expected — this is the new honest baseline Phase 2+ will be measured against, not a regression. No code changed in this phase. |
| 2. Context-aware matching | Done | 37.0% (unchanged — this phase targets precision, not coverage, by design) | 0.0% (unchanged) | **92.7% correct (114/123), up from 62.6%** — near-miss failure rate inverted from 47.5%/37.4% down to 7.3% | **100.0%, up from 85.4% — target (>=0.90) now MET** | 169.8ms (rose; see note) | Built `scripts/lib/tokenize-command.js` (34 unit tests): classifies each command segment's head command against a read-only allowlist (grep/cat/echo/man/git-log-show-diff-etc/find-without-delete/sed-without-i/editors), an evaluator set (eval/xargs/sh -c/bash -c, and piping into one), strips comments and redirection targets, and only exposes the non-inert text to risky-pattern matching. Wired into both the guard-rule and built-in-list matching passes in pre-bash.js. Also fixed the two confirmed regex bugs from the original verdict: added the `s` (dotAll) flag to every risky pattern and to `guardPatternToRegExp` (newline-sensitivity fix — also had to add explicit backslash-tolerance for real Bash line-continuation syntax, `\` + newline, found by a new test that failed on first pass), and added `normalizeWhitespace()` covering U+00A0/U+1680/U+2000-200A/U+2007/U+202F/U+205F/U+3000/U+FEFF, applied to the full command before splitting. 2 real bugs caught by the new tests before this phase could be called done: (1) `guardPatternToRegExp` was missing the dotAll fix applied to risky-commands.js, only found because a new guarded-rule newline test failed; (2) `git log --grep=...` was not being treated as read-only because "git" itself is correctly NOT in the generic read-only allowlist (most git subcommands are exactly what this tool exists to catch) — added a git-subcommand-aware sub-allowlist (log/show/diff/blame/help/status/etc.) instead. Remaining near-miss failures (9/123) are known, narrower gaps: `--help` flags, risky text inside a `git commit -m "..."` message, and filename/branch-name coincidences on commands not in the read-only set (`touch "rm -rf"`, `mkdir git-push-notes`) — documented, not silently claimed fixed. **Latency note**: p95 rose from 108ms to 170ms, plausibly from the added tokenizer work per invocation; flagged for Phase 4 to investigate and separate from pure process-spawn overhead. |

## Original status: build complete (9 phases); eval rebuild complete (5 phases) — VERDICT: NOT YET READY TO SHIP

A second, independent evaluation effort (evals/TARGETS.md through evals/results/VERDICT.md) was run after the initial build because the original Phase 7 integration evals were circular: every scenario was written from the design spec, so passing proved the code matched its own spec, not that it behaves well on real-world input. The rebuilt eval used a 388-row dataset labeled from human judgment (blind to the implementation where practically possible), including real commands from actual shell history, and produced an honest, unflattering result: **3 of 4 committed targets were missed**. Full detail: [evals/results/VERDICT.md](evals/results/VERDICT.md).

**Headline finding: this is not ready for strangers to install yet.** Dangerous-command recall is 65.6% (target 95%), meaning over a third of the irreversible actions this tool exists to catch are silently allowed. A real precision bug causes the tool to hard-deny completely safe commands (`echo`, `grep`, reading a file) by mistaking string arguments for real invocations. See VERDICT.md for the full breakdown and recommended fix order before shipping.

## Status: original 9-phase build complete

| Phase | Status | Notes |
|---|---|---|
| 0. Verify before building | Done | All 5 cited issues confirmed real via `gh issue view` (not taken on faith). No official fix has shipped — closures were stale-bot housekeeping (`NOT_PLANNED`/duplicate), not resolutions. Official docs fetched and recorded in docs/SPEC_NOTES.md. Found and logged a real competitor, Cozempic, not known at plan time. |
| 1. Design spec | Done | docs/DESIGN.md, every decision justified, limitations stated honestly including one the plan's own model didn't anticipate (context-depth decay without compaction, from live GitHub issue #92257 thread). |
| 2. Parser | Done | scripts/lib/parse-rules.js, 14 unit tests, all pass. |
| 3. PreToolUse hook | Done | scripts/pre-bash.js + risky-commands.js + lib/split-command.js, 14 unit tests. Found and fixed 2 real bugs during testing (see below). |
| 4. SessionStart hook | Done | scripts/session-start.js, 6 unit tests, all pass. |
| 5. Skill | Done | skills/rule-guard/SKILL.md, 44 lines (cap was 150). |
| 6. Plugin packaging | Done | Validated with the real `claude plugin validate .` command — passed clean after fixing one warning (missing marketplace description). |
| 7. Integration evals | Done | 10/10 fixture scenarios pass, run as real child processes through actual stdin/stdout (not mocked). Headless `claude -p` end-to-end stretch goal skipped by judgment call — see evals/HEADLESS_NOTE.md. |
| 8. README + launch assets | Done | README, DEMO_SCRIPT.md, CHANGELOG.md, LICENSE (MIT, added — plan didn't create one but README claimed the license). |
| 9. Final review | Done | Found and fixed 2 real doc bugs during skeptical read-through (see below) by actually running the commands, not just reading them. |

## Test results

- **34/34 unit tests pass** (`node --test tests/*.test.js`)
- **10/10 integration evals pass** (`node evals/run-evals.js`)
- Plugin structure validated clean via `claude plugin validate .`
- **Installed and verified end-to-end**: added local dir as a marketplace (`claude plugin marketplace add ./`), installed by name (`claude plugin install seatbelt`), confirmed `enabled` via `claude plugin list`. Left installed per user's choice.

## Real bugs found and fixed during this build (not hypothetical — caught by actually running things)

1. **`guardPatternToRegExp` didn't tolerate variable whitespace.** A guard pattern `git push` failed to match the command `git  push` (double space). Fixed by collapsing literal whitespace in the pattern into `\s+`.
2. **Built-in risky regexes required `git` and the subcommand adjacent.** `git -C repo push --force` wasn't caught because the original regex was `git\s+push`, not tolerant of flags in between. Fixed by loosening to `git\b.*?\bpush\b`.
3. **README's install instructions were wrong as originally written.** `claude plugin install /path/to/seatbelt` does not work — `install` always takes a plugin name resolved from a configured marketplace, never a raw path. Caught by actually running the command, not by inspecting it. Fixed README to the verified-working two-step flow (`marketplace add` then `install <name>`), and also caught that `marketplace add .` fails (needs `./` or an absolute path) while `add ./` works.
4. **README told contributors to run `node --test tests/`**, which fails on this Node version (needs an explicit glob). Fixed to `node --test tests/*.test.js`.

## Known limitations (by design, stated in README/SKILL.md, not hidden)

- Does not address rule decay from pure context depth within a session that never compacts (only `compact`/`resume` trigger re-injection in v1). This is a *sharper* understanding than the original plan had — surfaced by a live, ongoing GitHub issue thread (#92257) that was still being actively discussed by other users on the same day as this build, including a rigorous empirical measurement from a user (`bragboy`) showing continuous rule decay with context depth even with zero compactions.
- Does not fix AGENTS.md truncation (model/product-level bug, not hook-addressable).
- Does not fix the root cause in #88565 (auto mode preferring Bash over Read/Edit/Write) — instead catches the resulting risky *commands* regardless of tool path, which covers the damaging cases without needing to fix the routing itself.
- Regex-based Bash command matching cannot distinguish a quoted string from a real invocation (`echo "git push"` still triggers "ask"). Documented as a deliberate false-positive-over-false-negative tradeoff.
- v1 is Claude Code only. Cursor and Codex have different hook mechanisms; porting is out of scope.
- Not the first tool in this space: Cozempic (~100k claimed users, unverified self-reported figure) already does SessionStart-based rule-reminder injection as part of a broader context-pruning tool. README states this honestly and names the actual differentiator (PreToolUse command-level enforcement).

## What I need from you to actually publish/distribute (NOT run — your call)

These are documented here per the plan; none of them have been executed:

1. **Record the demo GIF** per docs/DEMO_SCRIPT.md and add it at `docs/demo.gif` (README currently references a placeholder).
2. **Decide on repo visibility/readiness** — the repo is already public at github.com/dripston/seatbelt (created earlier in this session per your explicit instruction), and all commits are pushed. If you want to hold it privately longer before anyone finds it, you'd need to flip it to private: `gh repo edit dripston/seatbelt --visibility private`.
3. **Pitch to maintainers/issue threads**, per your original plan and the demand-first approach we agreed on: comment on #92257 (and optionally #88565, #81999) linking this repo, ideally after the demo GIF exists so the comment has something concrete to show, not just a claim.
4. **Submit to marketplaces** (skills.sh, ClaudeMarketplaces, etc.) if/when you want broader discoverability — not done, and per your original hard rule this needs your explicit go-ahead since it's a distribution/publishing action.
5. **v0.2 candidate work**, if this gets any real traction: the depth-gated `UserPromptSubmit` re-injection trigger described in docs/DESIGN.md's known limitations, which bragboy's research suggests costs ~0.18% token overhead when properly threshold-gated.

## Repo state

- Public repo: https://github.com/dripston/seatbelt
- All 9 build phases + 5 eval-rebuild phases committed individually. Local commits only for the eval rebuild (not pushed) per this task's "no network, no publishing, no push" rule — everything from the original build phases (0-9) was pushed earlier per the user's explicit instruction to keep pushing; the eval rebuild work is currently local-only and needs an explicit decision on whether to push it.
- Authorship corrected mid-build (an early command set the wrong local git identity before being caught and fixed; history was reset and force-pushed once, early on, before any other collaborator could have pulled it)
- Currently installed locally at user scope on this machine for verification

## Eval rebuild: phase-by-phase

| Phase | Status | Notes |
|---|---|---|
| Targets | Done | evals/TARGETS.md committed before any dataset work or test runs, per the rule against moving goalposts after seeing results. |
| A. Dataset | Done | evals/dataset/dataset.jsonl, 388 rows (target: 300+). 117 real commands (from actual PowerShell history and this project's own real Claude Code session logs), 222 synthetic, 49 adversarial. Labeled from human judgment on what SHOULD happen; honesty note in LABELING_NOTES.md about the practical limits of "blind" labeling given I wrote the implementation myself. |
| B. Harness | Done | evals/run-classifier-eval.js feeds every row through the real scripts/pre-bash.js as a child process via stdin — the same path Claude Code itself uses. Raw results: evals/results/raw.jsonl. |
| C. Metrics | Done | evals/report.js produces evals/results/REPORT.md: full confusion matrix, per-class P/R/F1, per-category breakdown, latency percentiles, every failure listed. 8 dataset labels corrected after review with reasons logged in evals/dataset/LABEL_CORRECTIONS.md — corrections made the tool look BETTER (several "known gap" assumptions were wrong; the actual regex is more permissive than assumed), not worse, and are flagged as such rather than hidden. |
| D. Sensitivity analysis | Done | evals/run-tuning.js tests STRICT/CURRENT/LOOSE risky-command-list configurations via the plugin's own `rule-guard.config.json` override mechanism (a real code path, not a reimplementation). Result in evals/results/TUNING.md: CURRENT is recommended over both alternatives, but the near-miss false-positive problem is shown to be independent of list strictness (32-52% FPR across all three configs) — it needs a code fix, not a config change. |
| E. Verdict | Done | evals/results/VERDICT.md: honest "not ready to ship" verdict, 3/4 targets missed, top 3 failure patterns identified, plus a 4th unrelated bug (POSIX-style path handling silently breaks rule discovery on Windows) discovered incidentally while building the Phase D harness and independently verified. |

## Real bugs found during the eval rebuild (verified directly, not just observed as eval failures)

1. **Newline-sensitivity in the built-in "git push" regex.** `\bgit\b(?:(?!--dry-run).)*?\bpush\b(?!.*--dry-run)` uses `.` without the `s`/dotAll flag, so a command with a literal embedded newline between "git" and "push" is not matched, even though the same text on one line is. Verified directly and isolated to this exact cause.
2. **Non-breaking-space (U+00A0) evasion.** A non-breaking space in place of a normal space between "git" and "push" breaks the implicit whitespace matching. Verified directly.
3. **POSIX-style path handling silently breaks rule discovery on Windows.** `findAndParseRules()`/`loadConfiguredRisky()` use `path.join()`, which does not treat a POSIX-style absolute path (e.g. `/d/skill/project`) as absolute on Windows — it silently produces a nonexistent path, so CLAUDE.md/AGENTS.md/rule-guard.config.json are never found, and the tool falls back to "no rules" with no error surfaced. Confirmed with a clean, unambiguous test: the identical directory works via its Windows-style path and fails via its POSIX-style path. Severity in real-world Claude-Code-on-Windows-with-Git-Bash usage is flagged as plausible but NOT directly confirmed (would need to capture real hook input JSON from a live session on such a setup) — logged as a priority item to verify, not silently patched.
4. **Near-miss precision problem is structural, not a tuning issue.** Confirmed via Phase D: the false-positive rate on the near-miss bucket (commands that look risky but are actually `echo`, `grep`, comments, etc.) stays between 32% and 52% across all three risky-command-list strictness configurations. This proves the problem is in the matching logic itself (no awareness of command-position vs. string-argument context), not in which commands happen to be on the list.

None of these were fixed in this pass — per the eval task's explicit scope, this is a measurement and reporting exercise, and fixing the underlying code is separate, prioritized future work per VERDICT.md's recommendation.
