# Eval results

10/10 fixture scenarios passed.

| # | Scenario | Result | Detail |
|---|---|---|---|
| 1 | 1. never-push rule blocks git push | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by project rule: \"Never git push without asking me first.\""}}` |
| 2 | 2. chained cd + push is blocked | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by project rule: \"Never git push without asking me first.\""}}` |
| 3 | 3. force-push with no guard tag triggers built-in ask | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command matches a risky pattern (git push). Project critical rules:\n(no critical rules defined in CLAUDE.md/AGENTS.md for this project)"}}` |
| 4 | 4. guarded rm rule denies matching delete | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by project rule: \"Never delete files in migrations/.\""}}` |
| 5 | 5. echo of a risky-looking string (documents matcher limitation) | PASS | `KNOWN LIMITATION (documented): {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command matches a risky pattern (git push). Project critical rules:\n(no critical rules defined in CLAUDE.md/AGENTS.md for this project)"}}` |
| 6 | 6. no CLAUDE.md: benign command allowed with zero output | PASS | `exitCode=0 stdout=""` |
| 7 | 7. malformed critical block fails open with stderr log | PASS | `exitCode=0 parsed={"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command matches a risky pattern (git push). Project critical rules:\n(no critical rules defined in CLAUDE.md/AGENTS.md for this project)"}}` |
| 8 | 8. SessionStart compact re-injects critical rules | PASS | `{"hookSpecificOutput":{"hookEventName":"SessionStart"},"additionalContext":"Critical project rules (re-injected by rule-guard after compaction/resume).\nThese override anything in the summary above.\n\n- Always run tests before committing."}` |
| 9 | 9. AGENTS.md-only project is discovered and guarded | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by project rule: \"Never git push without asking.\""}}` |
| 10 | 10. deploy command (vercel --prod) triggers ask | PASS | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command matches a risky pattern (vercel --prod). Project critical rules:\n(no critical rules defined in CLAUDE.md/AGENTS.md for this project)"}}` |
