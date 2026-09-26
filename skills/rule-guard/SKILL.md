---
name: rule-guard
description: Use when the user wants to keep project rules alive in an agent's context across compaction, resume, or long sessions (e.g. "never push without asking", "always run tests first"), or when the user mentions Claude Code ignoring or forgetting CLAUDE.md/AGENTS.md instructions. Not for general coding help.
---

# rule-guard

Claude Code agents drop project rules mid-session — after context compaction, on resume, or just from being deep in a long session. This is a documented, unresolved gap (see anthropics/claude-code issues #92257, #88565, #81999, #34197, #43716). Pure instructions decay because the model can quote a rule accurately and still act against it — quoting proves the rule loaded, not that it's still governing behavior.

This skill's plugin (seatbelt) mitigates this two ways: re-injection (keeps the user's own rules present in context, on three triggers — compaction, resume, and context depth) and guard-match nudging (a `PreToolUse` hook that surfaces a plain heads-up when a Bash command matches a pattern the user explicitly tagged on a rule). Neither one blocks anything — nudging only ever asks, never denies. (An earlier version tried general command-danger classification instead of user-authored pattern matching; two rounds of testing found that detector's recall on unfamiliar tools was unstable and ecosystem-dependent, so it was cut. The code is preserved on the `archive/enforcement` branch, not deleted, if asked about it. Guard-match nudging is a different, narrower thing: zero classification, just literal/wildcard matching against a pattern the user wrote themselves.)

## Helping the user write rules

Rules live in `CLAUDE.md`, `.claude/CLAUDE.md`, or `AGENTS.md` — either as a marked block or as plain prose in the file:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first.
- Never delete files in migrations/.
- Always run tests before committing.
<!-- /rule-guard:critical -->
```

The marker is optional, not required. seatbelt's default re-injection mode (`auto`) injects the whole file when it's small enough, falls back to the marked block if the file is too large, and falls back to the first 40 lines if neither fits. Most users don't need to learn the marker syntax at all — only suggest it when a project's CLAUDE.md is large enough that re-injecting the whole thing would be wasteful, and the user wants to scope re-injection down to a few critical lines.

A rule can also get a guard pattern, which enables the separate nudge trigger (not re-injection):

```markdown
<!-- rule-guard:critical -->
- Never push without asking me first. [guard: git push]
<!-- /rule-guard:critical -->
```

`*` is a wildcard (`[guard: rm * migrations/*]` matches any `rm` touching `migrations/`). Only suggest this when the user wants a specific, nameable command pattern actively flagged the moment it's about to run — not for vague/subjective rules ("be careful with prod"), since guard matching is literal/wildcard string matching, not judgment. A rule with no guard tag is still re-injected normally; it just never triggers a nudge. Never suggest a wildcard-only pattern like `[guard: *]` — it has no literal content to anchor on and would match every command; seatbelt silently drops patterns like this rather than nudging on everything.

When a user asks you to set this up:
1. Ask what rules they most want to survive a long session or a compaction event.
2. Write them as plain bullet points in whichever file the project already uses (don't create a second rules file if one exists).
3. Only add the `<!-- rule-guard:critical -->` marker if the file is large and the user wants re-injection scoped to specific lines rather than the whole file.
4. If a rule maps to a concrete, literal command pattern (not a vague judgment call), offer a `[guard: pattern]` tag so it also gets the nudge trigger.
5. If the user wants different depth thresholds or injection modes than the defaults, help them write a `.claude/seatbelt.json` — see README.md's Configuration section for the fields (`firstFire`, `interval`, `mode`, `maxInjectTokens`, `minTurnsBetween`).
6. In a monorepo, the rules file (and `.claude/seatbelt.json`) can live at the repo root even if the user works from a subdirectory — seatbelt walks upward to find it, stopping at the repo's `.git` boundary. No special setup needed.

## The four triggers, briefly

1. **Compaction** — `SessionStart` fires with `source: compact` right after Claude Code compacts a session; seatbelt re-injects.
2. **Resume** — same hook, `source: resume`, when a saved session is resumed.
3. **Depth** — `UserPromptSubmit` estimates transcript token depth and re-injects once past a threshold (default 100,000 tokens, then every 50,000), independent of compaction, with a turn-count floor so an estimation quirk can't spam re-injections.
4. **Guard match** — `PreToolUse` on shell commands (Claude Code's `Bash` tool, and its Windows `PowerShell` fallback when Git Bash isn't detected). If the command matches a `[guard: pattern]` a rule was tagged with, emits a plain `"ask"` heads-up naming the rule. Addresses a different failure mode than the other three: the model can have the rule in context and still act against it, so this catches the moment of the action itself rather than relying on re-injected text to be enough.

## What this plugin does NOT do

Be upfront about these limits if asked, rather than implying the plugin is more than it is:
- It never blocks a command. The guard-match nudge only ever asks (`permissionDecision: "ask"`), never denies.
- It does not detect or judge what's "dangerous" in general — the nudge only fires on a pattern the user wrote themselves; there's no content it has an opinion on beyond that.
- The guard-match nudge does raw string matching, not shell parsing — a command that hides the matching text behind piping, chaining, or `eval` may not match. That's an accepted tradeoff for a nudge (a miss just means no reminder), and is why this doesn't reuse the more complex command-tokenizing pipeline the killed enforcement feature needed.
- A rule present in context, or a nudge before a matching command, makes the model more likely to comply, not guaranteed to.
- It cannot fix AGENTS.md truncation on very long files — that's a separate, model-context-level bug.
- The adherence benefit of re-injection itself is not yet confirmed by a clean measurement — real test runs found a null result and surfaced infrastructure bugs rather than a clear signal either way. Say this plainly if asked how well it actually works, rather than overstating it. (This caveat is about re-injection specifically; guard-match nudging is a direct action-time intervention, not something the same adherence-measurement question applies to in the same way.)
