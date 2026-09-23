# Hook input evidence: is the POSIX-path bug reachable in practice?

## Method

Added temporary, unconditional debug instrumentation to `scripts/pre-bash.js` (a few lines appending raw stdin to a log file, removed at the end of this phase — see git history if needed) and reinstalled the plugin (`claude plugin marketplace update` + uninstall/reinstall) so the running copy in `~/.claude/plugins/cache/` picked up the change. Then triggered real Bash tool calls in an actual, live Claude Code session (this one) on Windows, in a Git Bash shell, and captured the exact raw JSON Claude Code sent to the `PreToolUse` hook.

A first attempt using `claude -p` in a nested subprocess failed to produce any hook firings at all — investigated via `--debug hooks --debug-file`, which revealed the nested subprocess logged `Git Bash not found; BashTool will be unavailable`, meaning no Bash tool call ever actually executed in that nested session (Claude answered conversationally instead). That was a broken test setup, not evidence about hooks — discarded, and the real test was done directly in this live session instead, where the Bash tool is confirmed working (used throughout this entire conversation).

## Raw captured data (4 samples, this session's own tool calls)

```json
{"session_id":"8b52c858-012f-47ad-9277-19f5d79a5d9b","cwd":"D:\\skill","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo \"test-in-live-session-for-real-hook-capture\""}}

{"session_id":"8b52c858-012f-47ad-9277-19f5d79a5d9b","cwd":"D:\\skill","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cd /d/skill/docs && echo \"second-sample-different-subdirectory\""}}

{"session_id":"8b52c858-012f-47ad-9277-19f5d79a5d9b","cwd":"D:\\skill\\docs","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"tail -5 /d/skill/docs/hook-capture-raw.log 2>&1"}}

{"session_id":"8b52c858-012f-47ad-9277-19f5d79a5d9b","cwd":"D:\\skill\\docs","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cd /d/skill && cat docs/hook-capture-raw.log"}}
```

(transcript_path, scratchpad_dir, prompt_id, tool_use_id, permission_mode, effort fields omitted above for brevity — none contained anything sensitive; full raw lines are in git history of this file's first commit if ever needed, though the debug log itself was deleted and not committed.)

## Environment

- OS: Windows 11 (win32, per this session's own environment header)
- Shell: Git Bash (the Bash tool used throughout this entire build; `pwd` inside it reports POSIX-style paths like `/d/skill`)
- Claude Code version: whatever is currently installed via `claude` on this machine (session did not check `claude --version` explicitly during this test, but it's the same binary used for the entire prior build)

## Finding: plain yes/no

**No — Claude Code does NOT send a POSIX-style `cwd` to hooks, even when running inside Git Bash on Windows.**

Across 4 independent samples, including one taken immediately after `cd /d/skill/docs` (a command written in POSIX style, as Git Bash requires), the `cwd` field Claude Code actually passes to the `PreToolUse` hook is consistently **Windows-native format with proper backslashes** (`D:\\skill`, `D:\\skill\\docs`) — never the POSIX-style form the shell itself uses internally (`/d/skill`, `/d/skill/docs`). Claude Code evidently normalizes the working directory to native OS format before constructing hook input, regardless of what path syntax the user's shell or command uses.

## Implication for the fix plan

The POSIX-path bug found in `findAndParseRules()`/`loadConfiguredRisky()` (`path.join()` mishandling a POSIX-style absolute path on Windows) is a **real, confirmed code defect** — it was reproduced directly and unambiguously in the original evaluation. But per this direct evidence, it is **not reachable via the actual `cwd` value Claude Code sends**, at least not in the one configuration tested here (Windows + Git Bash + current Claude Code version). 

Per the fix plan's own instruction for this outcome: this is recorded as not reachable in practice. The path handling will still be hardened defensively in this phase (cheap, no downside, and covers hypothetical future cases — e.g. a user manually invoking the scripts with a POSIX-style cwd via `rule-guard.config.json`-driven tooling, or a different terminal/shell environment not tested here), but it is not treated as a release-blocking critical issue the way it would be if this evidence had come back "yes."

## Cleanup

The debug instrumentation added to `scripts/pre-bash.js` for this test has been removed (see the commit immediately following this one). `docs/hook-capture-raw.log` and `docs/debug-output.log` were deleted, not committed — they contained only this session's own test command text, already visible in this conversation, but there's no reason to carry local debug artifacts into the repo.
