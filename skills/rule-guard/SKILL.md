---
name: rule-guard
description: Use when the user wants to set up project rules that an agent must never silently break (e.g. "never push without asking", "always run tests first"), when the user mentions Claude Code ignoring or forgetting CLAUDE.md/AGENTS.md instructions, or when the user wants risky shell commands (git push, force-push, rm -rf, deploys) checked against project rules before they run. Not for general coding help.
---

# rule-guard

Claude Code agents drop project rules mid-session — after context compaction, in long sessions, or when editing through Bash instead of the Edit tool. This is a documented, unresolved gap (see anthropics/claude-code issues #92257, #88565, #81999, #34197, #43716). Pure instructions decay because the model can quote a rule accurately and still act against it — quoting proves the rule loaded, not that it's still governing behavior.

This skill's plugin (`rule-guard`/seatbelt) mitigates this with two deterministic hooks that run outside the model:
- `SessionStart` re-injects critical rules after compaction/resume.
- `PreToolUse` checks every Bash command against critical rules and a built-in risky-command list, and can deny or ask before the command runs.

## Helping the user write a critical block

Critical rules live in a special HTML-comment-delimited block inside `CLAUDE.md`, `.claude/CLAUDE.md`, or `AGENTS.md`:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first. [guard: git push]
- Never delete files in migrations/. [guard: rm * migrations/*]
- Always run tests before committing.
<!-- /rule-guard:critical -->
```

When a user asks you to set this up:
1. Ask what actions they never want done without confirmation (git push, force-push, deletes, deploys are the common ones).
2. For each rule that maps to a specific shell command pattern, add a `[guard: <pattern>]` tag. Use `*` as a wildcard for variable parts (e.g. `rm * migrations/*`).
3. Rules with no natural command mapping (style rules, process rules like "always ask before assuming") should be written without a guard tag — they'll still be re-injected after compaction, but can't be mechanically enforced against a specific command.
4. Write the block into whichever file the project already uses (don't create a second rules file if one exists).

## Self-check protocol

Before running any git push, force-push, `rm -rf`, deploy-like command, or any other action that matches a project's critical rules — even if you believe the hook will catch it — restate the relevant critical rule(s) to yourself and confirm the pending action actually complies. The hook is a safety net, not a substitute for reading your own instructions.

If a `PreToolUse` hook denies or asks about a command you issued, don't retry the same command a different way to route around it. Explain to the user what rule the command matched and ask how they want to proceed.

## What this plugin cannot fix

Be upfront about these limits if asked, rather than implying the plugin is a complete fix:
- It cannot stop AGENTS.md truncation on very long files (a separate, model-context-level bug).
- It cannot make Bash-tool edits trigger the same path-scoped rule injection that Read/Edit/Write tools get — it instead catches risky *commands* regardless of which tool path produced them, which covers the common damaging cases (push, force-push, deletes, deploys) but not path-scoped content rules edited via Bash.
- It does not address rule decay that happens purely from context depth within a single session that never compacts — only compaction/resume events trigger re-injection in v1.
- A regex-based command matcher cannot perfectly distinguish a real invocation from a quoted string containing the same text (e.g. `echo "git push"` will still trigger an ask). This is a known false-positive tradeoff in favor of never missing a real one.
