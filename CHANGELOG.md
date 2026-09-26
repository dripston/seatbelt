# Changelog

## v0.3.3 — fix: a wildcard-only guard pattern silently matched every command

Asked directly to audit the repo for flaws, without waiting for a specific bug to be pointed at first. Went looking at `guardPatternToRegExp` and `findGuardedRules` since they're the newest, least-scrutinized code.

Found: a guard pattern made of only `*` and/or whitespace — e.g. `[guard: *]`, `[guard: **]` — is valid per the documented pattern syntax (`*` matches any characters, including none) and compiles to a regex equivalent to `/.*/is`, which matches every possible command unconditionally. A user writing this (plausibly by mistake — e.g. trying to "guard anything risky" without realizing a bare wildcard means "match everything") would silently turn "nudge on this one command" into "nudge on every single command, forever," with no warning that anything was wrong.

- Fixed: `findGuardedRules` now detects a guard pattern with no literal content left after stripping `*` and whitespace, drops it, and warns on stderr naming the offending rule — matching this codebase's existing pattern of warning rather than silently misbehaving (see `load-config.js`'s string-coercion warning).
- Added tests locking in both the detection logic and the real end-to-end behavior (a bare `[guard: *]` no longer nudges on an unrelated command).
- README/SKILL.md updated to document this explicitly, including telling the agent never to suggest a wildcard-only pattern to a user.

Also checked and ruled out as non-issues during this pass: guard patterns using forward slashes not matching backslash paths on native Windows shells (a real but narrow, already-documented raw-string-matching tradeoff, not a new bug); repeated identical guard nudges on retried commands (matches Claude Code's own native permission-prompt behavior, not a seatbelt defect); malformed/unclosed HTML comments surviving into `'full'`-mode re-injected content (expected verbatim-injection behavior, not a parsing bug, since `'full'` mode doesn't parse).

## v0.3.2 — fix: an async hook crash could exit non-zero instead of failing open

Asked directly: "is there something we can't do in the CLAUDE.md ingestion pipeline" that could cause more failures. Traced every hook script's entrypoint end to end rather than just its internal logic, since that's the boundary between "seatbelt has a bug" and "seatbelt crashes ungracefully in a way Claude Code has to handle."

Found: all four hook scripts (`session-start.js`, `depth-check.js`, `guard-check.js`, `session-end.js`) call an `async main()` bare at module scope with no `.catch()`. Every internal code path is defensively wrapped and every doc comment in this codebase claims "never crash, fail open" — but `process.stdout.write(...)` right before the final `process.exit(0)` sits outside all of those try/catches in every script. Reproduced directly: a throwing `stdout.write` with a bare `main();` exits the process with code 1 and a stack trace on stderr, not the clean `exit 0` every other path guarantees. This is reachable in practice via EPIPE (the parent closing the hook's stdout pipe early, e.g. on a timeout), not just a contrived edge case.

- Fixed: every hook script's `main()` invocation is now `main().catch(() => process.exit(0))`, so any rejection — from anywhere in the call chain, including the previously-unguarded final write — resolves to a clean exit instead of propagating unhandled.
- Added `tests/main-fail-open.test.js`: proves the `.catch()` wrapper pattern converts a rejection into a clean outcome, and statically checks all four real hook script files actually contain the wrapper (confirmed to fail against the pre-fix files, so it's a genuine regression guard, not a no-op).
- Attempted to reproduce a real OS-level EPIPE through spawned child processes first, per this project's evidence-before-claim practice; Windows pipe/buffering behavior didn't reproduce it reliably enough to serve as a test, so the test instead locks in the exact code pattern that fixes the underlying defect. Noted here rather than shipped silently as if it were a full end-to-end proof.

## v0.3.1 — fix: guard-match nudge was inert on Windows without Git Bash

Verified v0.3.0's new `PreToolUse` hook against a real, live `claude` invocation before calling it done (this project's own established practice — the `additionalContext` nesting bug in v0.2.0 was also only found this way). Found: on a Windows machine where Claude Code can't detect Git Bash, it logs "Git Bash not found; BashTool will be unavailable" and routes shell execution through a tool literally named `PowerShell`, not `Bash` — confirmed via a live hook-input capture. `guard-check.js`'s hook registration matched only `"Bash"`, so on any such machine the `PreToolUse` dispatcher never invoked the script at all: completely inert, silently, exactly the failure mode this project exists to prevent.

- Fixed: `hooks.json`'s `PreToolUse` matcher is now `"Bash|PowerShell"`; `guard-check.js` accepts either `tool_name` via a new `isMatchedTool()` (both tools carry the command string under the same `tool_input.command` field, confirmed live).
- Re-verified live end-to-end after the fix: a guarded `git push` run through the `PowerShell` fallback path now correctly triggers the nudge; an unrelated command still runs silently with no nudge.
- Added unit + end-to-end tests locking in `PowerShell` as an accepted tool name, so this can't silently regress.

## v0.3.0 — guard-match nudge

**Added a fourth trigger: guard-match nudging.** Re-injection addresses one failure mode (a rule falls out of context). It doesn't address a different one: the model can have the rule in context and still act against it — quoting a rule proves it loaded, not that it's still governing behavior.

- Added: `PreToolUse` hook on Bash (`scripts/guard-check.js`). If a command matches a `[guard: pattern]` tag the user explicitly wrote on a rule, emits `permissionDecision: "ask"` naming the matched rule — a visible heads-up, never a `"deny"`. Unguarded rules can never trigger this; only ever re-injected.
- This is deliberately **not** a revival of v0.1.0's command classification. It does zero judgment calls: literal/wildcard string matching against a pattern the user wrote themselves, same risk profile as a `.gitignore` pattern, not a danger-detection heuristic. No command tokenizing/splitting/shell-trick handling either — a command that hides the matching text behind piping or `eval` may not match, which is an acceptable miss for a nudge (cost: no reminder) where it would not have been acceptable for a blocker (cost: a real command going unblocked).
- Re-added `guardPatternToRegExp` and a new `findGuardedRules(cwd)` to `scripts/lib/parse-rules.js`, scoped to this narrower purpose (they were deleted as dead code from the killed v0.1.0 enforcement feature one commit prior; this is a deliberate, scoped re-addition, not a revert).
- Fixed in passing: `depth-state.js`'s stale-file pruning did a full OS-temp-directory scan on every `UserPromptSubmit` (every prompt, not once per session, despite its own comment claiming otherwise) — throttled to once per 10 minutes per process.
- README/SKILL.md updated: the "does not block or check any command" claim from v0.2.0 is no longer accurate and has been corrected; the underlying reason enforcement was cut (unreliable classification) is preserved and clarified as not applying to guard-match nudging (no classification involved).

## v0.2.0 — scope cut: re-injection only

**Enforcement removed.** v0.1.0's `PreToolUse` hook (command-level deny/ask against risky Bash commands) is cut. Two rounds of structural-detection work found its recall against tools it hadn't seen before was unstable and ecosystem-dependent (12%, then 60%, then 40% across three independently-built blind tests), which is not a foundation to ship a safety claim on. The removed code and its full evaluation history are preserved on the `archive/enforcement` branch, not deleted.

**seatbelt's remaining and only job: keep the user's own CLAUDE.md/AGENTS.md rules alive in context.** It reminds; it does not enforce.

- Removed: `scripts/pre-bash.js`, `scripts/risky-commands.js`, `scripts/lib/assess-reversibility.js`, `scripts/lib/split-command.js`, `scripts/lib/tokenize-command.js`, `scripts/lib/structural-danger.js`, their tests, and the `PreToolUse` hook registration.
- Added: three content modes for what gets re-injected (`block` / `full` / `auto`, `scripts/lib/select-content.js`) — `auto` is now the default, injecting the whole rules file when it fits a token budget so users don't need to learn the marker syntax.
- Added: a third re-injection trigger, context depth. New `UserPromptSubmit` hook (`scripts/depth-check.js`) estimates transcript token depth and re-injects past a threshold (default 100,000 tokens, then every 50,000), independent of compaction — addressing a gap that a session which never compacts still loses adherence purely from depth.
- Added: `.claude/seatbelt.json` project configuration (`firstFire`, `interval`, `mode`, `maxInjectTokens`, `minTurnsBetween`).
- Added: `scripts/session-end.js` (`SessionEnd` hook) to clean up depth-tracking state.
- Fixed: `session-start.js` was emitting `additionalContext` at the wrong JSON nesting level (top-level instead of under `hookSpecificOutput.additionalContext`), meaning `SessionStart` re-injection — the original v0.1.0 feature — was a silent no-op against the real Claude Code hook contract the whole time. Found via a live `--debug hooks` trace, not by any unit test. New end-to-end schema tests guard against this regressing silently again.
- Fixed: rule and config discovery only ever checked the exact working directory, so a session started in a monorepo subdirectory (`cd packages/api && claude`) found zero rules even with a valid `CLAUDE.md` at the repo root. Discovery now walks upward toward a `.git` boundary or 10 levels, merging rules found at every level.
- README and SKILL.md rewritten around the reduced scope; every enforcement claim and accuracy number from v0.1.0 removed from user-facing docs (preserved in `archive/enforcement` and in git history).

## v0.1.0

Initial release.

- `PreToolUse` hook on Bash: checks commands against user-defined critical rules (`[guard: pattern]` tags) and a built-in risky-command list (git push/force-push, git reset --hard, git clean -f, git branch -D, rm -rf, git checkout -- ., common deploy commands). Denies on guarded-rule match, asks on built-in-list match, silent allow otherwise. Fails open on any internal error.
- `SessionStart` hook: re-injects critical rules as context on `compact` and `resume` events.
- `rule-guard` skill: helps users write critical blocks and documents the self-check protocol and known limitations.
- Discovers rules from `CLAUDE.md`, `.claude/CLAUDE.md`, and `AGENTS.md`, merging all found blocks.
- Configurable risky-command list via `rule-guard.config.json`.
- 34 unit tests (parser, PreToolUse decision logic, SessionStart context building) + 10/10 integration evals against real hook processes.

### Known limitations (see README)

- Does not address rule decay from context depth alone in a session that never compacts (only compact/resume trigger re-injection).
- Does not fix AGENTS.md truncation on very long files.
- Regex-based command matching can false-positive on quoted strings that resemble risky commands.
- Claude Code only — Cursor/Codex support is out of scope for v1.
