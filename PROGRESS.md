# Progress: seatbelt build

## Status: all 9 phases complete

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
- All 9 phases committed individually and pushed to `master`
- Authorship corrected mid-build (an early command set the wrong local git identity before being caught and fixed; history was reset and force-pushed once, early on, before any other collaborator could have pulled it)
- Currently installed locally at user scope on this machine for verification
