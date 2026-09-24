# Design: seatbelt (rule-guard plugin)

## Critical block syntax

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first. [guard: git push]
- Never delete files in migrations/. [guard: rm * migrations/*]
- Always run tests before committing.
<!-- /rule-guard:critical -->
```
One-line justification: HTML comments are invisible in rendered markdown and won't clutter CLAUDE.md's normal prose, and are trivially regex-findable without a full markdown parser.

Rules with a trailing `[guard: <pattern>]` are linked to command matching (Phase 3). Rules without it are re-injection-only (Phase 4) — they can't be mechanically checked against a shell command, so we don't pretend to enforce them, only remind the agent of them.

## File discovery order

`./CLAUDE.md`, `./.claude/CLAUDE.md`, `./AGENTS.md` — all three are read if present, and all critical blocks found across them are merged into one rule set.
One-line justification: users may have either/both file conventions (CLAUDE.md is Claude-specific, AGENTS.md is the cross-tool standard many are asking Claude Code to also support per issue #6235) — merging avoids picking a side.

## Built-in risky command list (always "ask" even with no guard tag)

`git push`, `git push --force`, `git push -f`, `git reset --hard`, `git clean -f`, `git branch -D`, `rm -rf`, `git checkout -- .`, `vercel --prod`, `firebase deploy`, `kubectl apply`, `terraform apply`.
One-line justification: these are the specific commands named across the verified issues (#81999: push; #88565's real-world example: config file edits) and are irreversible or hard-to-reverse by nature, matching the operating principle that hard-to-reverse actions deserve a check regardless of whether the user thought to write a rule for them.

This list is configurable via a `rule-guard.config.json` at project root (optional; falls back to the built-in list if absent) so users can add/remove entries without editing plugin code.
One-line justification: a hardcoded list can't fit every project's definition of "risky" (e.g. a project with no deploy step doesn't care about `vercel --prod`), and the plan calls for "configurable."

## Decision logic (PreToolUse on Bash)

1. Parse the command into segments (see chaining section below).
2. For each segment: check against **guarded rules** first (pattern from a `[guard: ...]` tag). Match → `deny`, reason = the exact rule text quoted back.
3. If no guarded-rule match: check against the **built-in risky list**. Match → `ask`, reason = "This matches a risky-command pattern. Project critical rules: <list all critical rules found>."
4. No match anywhere → print nothing (allow silently, zero overhead, no noise).
One-line justification: `deny` for an explicit user-authored rule respects their stated intent exactly (they said never); `ask` for the built-in list is a safety net for commands the user didn't think to write a rule for, but shouldn't auto-block since they didn't actually forbid it.

## Chained commands and subshells

Split on `&&`, `;`, `|`, and check every resulting segment independently against both guard patterns and the built-in list. A match on any segment triggers the decision for the whole command (can't selectively allow part of a compound Bash invocation).
One-line justification: issue #88565's discussion and the eval scenarios explicitly include `cd sub && git push origin main` — a naive whole-string regex would still catch that particular example, but chaining is the general case attackers/agents combine actions through, so segment-splitting is the only robust approach.

## Failure mode: fail open

If the parser throws, the critical-block files are unreadable, or any unexpected exception occurs: catch it, write a one-line diagnostic to stderr, and print nothing to stdout (equivalent to `allow`).
One-line justification: a security/guard tool that can crash into "block everything" turns a helpful plugin into a session-bricking liability the first time someone's CLAUDE.md has a unicode quirk — failing open trades a missed catch for never breaking the user's actual work, which matches the plan's explicit requirement.

## Performance budget: <100ms

Achieved by: no external dependencies (Node built-ins only, per hard rules), no network calls, no full markdown AST parsing (regex-based block extraction is sufficient for a fixed comment-delimited format), and reading only the 1-3 candidate files rather than scanning the whole repo.
One-line justification: PreToolUse hooks run synchronously in the user's interactive path — slow hooks are their own new complaint category (see #32691 "compaction... takes too long, disrupting workflow" as an example of latency itself being a filed bug).

## Known limitations (stated honestly, not hidden)

1. **Depth-gated decay within a single uncompacted session is not covered.** Per docs/EVIDENCE.md, a session that never compacts can still lose rule adherence purely from context depth (bragboy's measured dose-response curve). Our `SessionStart` hook only fires on `compact`/`resume`, so it won't help a long, never-compacted session. Logged as a v0.2 candidate: a `UserPromptSubmit` hook gated on transcript size/depth threshold, matching the mechanism bragboy costed at ~0.18% token overhead.
2. **Does not fix AGENTS.md truncation** (Codex issue #13386/#43075) — that's a model-context-window/product-level bug, not something a hook can patch.
3. **Does not fix the underlying reason auto mode bypasses Read/Edit/Write** (root cause in #88565) — our PreToolUse hook catches the *symptom* (a risky command executing) regardless of which tool path produced it, which is actually a strength: we don't care how the command was proposed, only what it is.
4. **Not the first tool to touch this space.** Cozempic (pip package, ~100k claimed users, unverified self-reported number) already does SessionStart-hook-based rule-freshness reminders as a side effect of its context-pruning focus. seatbelt's distinct contribution is **PreToolUse command-level deny/ask enforcement against user-authored rules** — nothing found in research does this specific thing. README must state this honestly rather than implying seatbelt is the only tool addressing rule decay at all.

## Scope: Claude Code only for v1

Cursor and Codex have different hook/rule mechanisms (confirmed different from Claude Code's documented hook system) — porting is a v2 concern, not v1.

---

## v2: depth-triggered re-injection (`UserPromptSubmit`)

Addresses known limitation #1 above: a session that never compacts still loses rule adherence purely from context depth. `SessionStart` only fires on `compact`/`resume`, so a long uncompacted session was never covered. `scripts/depth-check.js`, registered on `UserPromptSubmit`, closes that gap.

### Threshold basis

Default `firstFire: 100000`, then every `interval: 50000` after. Reasoning (see docs/EVIDENCE.md for the underlying dose-response citation):
- Measured rule-adherence degradation begins in the 50K-100K token range, with a stable region extending to roughly 40% of the model's max context and a sharp drop near 50%.
- Claude Code's context window is roughly 200K tokens, so 40% is ~80K.
- An existing community context-refresh hook (cited in docs/EVIDENCE.md, ~0.18% token overhead when threshold-gated) uses 90,000 as its fire point.
- 100,000 sits at the start of the degradation zone and before the steep part of the drop-off — later than the community hook's 90K (erring toward fewer, more necessary injections) but still before the region where adherence measurably falls off a cliff.

These are defaults, not claims of precision — `.claude/seatbelt.json`'s `firstFire`/`interval` let a project tune them.

### Token estimation

`scripts/lib/estimate-transcript-tokens.js`: ~4 chars/token, no dependencies. Below a 2MB file-size cutoff, reads and counts the transcript exactly; above it, estimates from file size alone (byte count is a fine proxy for JSONL text size when only a threshold crossing matters, not an exact figure). This keeps the added per-turn cost bounded even on a very long session's transcript.

### Firing logic

`scripts/lib/depth-decision.js`'s `shouldFire()`: fires once estimated tokens cross `firstFire` (if never fired this session), then again every `interval` tokens past the last fire point — not a fixed multiple of `firstFire`, so a config change or unusual growth pattern mid-session still behaves sensibly relative to when it last actually fired. A hard floor (`minTurnsBetween`, default 10) blocks any fire regardless of token math if fewer than that many turns have passed since the last fire, so an estimation bug or a pathological transcript-size jump can't spam re-injections.

State (last-fired token count, turns since last fire) is tracked in a temp-dir file keyed by `session_id` (`scripts/lib/depth-state.js`), sanitized against path-traversal characters in the id. Best-effort only: a lost or corrupted state file degrades to "never fired" defaults, never a crash. `SessionEnd` (`scripts/session-end.js`) deletes the state file when practical; if it doesn't run (e.g. the process is killed), the file is small and harmless left behind in the OS temp dir.

### Injection phrasing (tested)

Claude Code's prompt-injection defenses can flag hook-injected text that reads as an out-of-band system command, surfacing it to the user as a warning instead of feeding it to the model as context. Both `session-start.js` and `depth-check.js` use the same plain phrasing:

```
Project rules from CLAUDE.md/AGENTS.md:

<rule text or full file content>
```

Deliberately avoided: `SYSTEM:`, `You must`, `IMPORTANT INSTRUCTION`, or any directive-envelope framing. (The original `session-start.js` wording — "These override anything in the summary above." — was itself replaced during this pass for the same reason, even though it predates this hook.) Tested manually via a direct hook invocation with a real `UserPromptSubmit` payload; the emitted `additionalContext` was accepted without a surfaced injection warning.

### Interaction with `--continue`/`--resume`

On `--continue`/`--resume`, Claude Code replays saved `UserPromptSubmit` text from the prior session rather than re-running the hook for those past turns — so any depth-triggered injection captured in a replayed transcript is stale by the time it's replayed (it reflects token depth at the time it was first generated, not now). This is fine: `SessionStart`'s `resume` trigger already re-injects fresh rules at the moment a session resumes, covering exactly the case `--resume`/`--continue` creates. `depth-check.js` only needs to handle depth accumulated during the live portion of a session going forward from that point.
