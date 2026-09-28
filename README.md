<div align="center">

# 🪢 seatbelt

### Your agent forgets your rules. seatbelt puts them back.

**A Claude Code plugin that keeps your `CLAUDE.md` alive — through compaction, resume, and long sessions — and gives you a heads-up before a command runs into a rule you wrote.**

[![version](https://img.shields.io/badge/version-0.4.1-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![tests](https://img.shields.io/badge/tests-140%2F140%20passing-brightgreen)](tests/)
[![scope](https://img.shields.io/badge/scope-reminder%2C%20not%20enforcer-orange)](#what-seatbelt-is-not)

[Install](#install) · [Why](#why-this-exists) · [How it works](#how-it-works) · [Config](#configuration) · [Limits](#what-seatbelt-is-not)

</div>

---

You wrote the rule once. Claude followed it — for a while. Then the session got long, or got compacted, or got resumed, and the rule quietly stopped mattering. Not because Claude "decided" to ignore it — because it fell out of context, and nothing told you.

That's the gap seatbelt closes. Two moves, nothing clever:

- **It reminds.** Right when your rules are most likely to have fallen out — after compaction, after resume, deep into a long session — seatbelt re-reads your `CLAUDE.md` and pushes it back into context, silently, with a one-line confirmation so you know it happened.
- **It nudges.** If you've flagged a rule with a guard pattern, seatbelt watches for a shell command that matches it and surfaces a plain heads-up right before it runs — using Claude Code's own permission prompt, not a popup, not a block.

It never blocks anything. It never guesses what's "dangerous." It only acts on rules you wrote, word for word.

```text
                    ┌─────────────────────────────┐
   compaction  ───▶ │                             │
   resume      ───▶ │   your rules, re-injected   │ ───▶  agent sees them again
   deep context ──▶ │                             │
                    └─────────────────────────────┘

   your command  ──▶  matches a rule you flagged?  ──▶  "heads up" nudge, not a block
```

## Install

```bash
claude plugin marketplace add dripston/seatbelt
claude plugin install seatbelt
```

That's it. No config file required to get value — keep writing your `CLAUDE.md` the way you already do:

```markdown
<!-- CLAUDE.md -->
- Never git push without asking me first.
- Never delete files in migrations/.
- Always run tests before committing.
```

Small files get re-injected whole automatically. Working with a big `CLAUDE.md` and only want specific lines kept alive at depth? Wrap them:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first.
<!-- /rule-guard:critical -->
```

Want a heads-up right before a matching command runs, on top of the reminder? Tag it:

```markdown
<!-- rule-guard:critical -->
- Never push without asking me first. [guard: git push]
<!-- /rule-guard:critical -->
```

`*` is a wildcard — `[guard: rm * migrations/*]` catches any `rm` touching `migrations/`. It's a literal/wildcard string match against exactly what you wrote, not a classifier, and it's entirely optional. Unguarded rules are only ever reminders, never nudges.

Monorepos work with zero setup — run Claude Code from any subdirectory and seatbelt walks up to find your repo-root `CLAUDE.md`.

## Why this exists

This isn't a hunch — it's a documented, still-open gap in Claude Code itself:

- [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) — re-injection feature request, 7 duplicate reports, plus measured adherence decay with context depth.
- [anthropics/claude-code#88565](https://github.com/anthropics/claude-code/issues/88565) — auto mode routes edits through Bash, bypassing rule injection.
- [anthropics/claude-code#81999](https://github.com/anthropics/claude-code/issues/81999) — an explicit "every time, no exceptions" rule breaks after a few cycles.
- [anthropics/claude-code#34197](https://github.com/anthropics/claude-code/issues/34197), [#43716](https://github.com/anthropics/claude-code/issues/43716) — CLAUDE.md ignored in long sessions.

seatbelt doesn't fix Claude Code's context handling. It compensates for it — the way a seatbelt doesn't prevent the crash, it just makes sure you're still buckled in when it happens.

## How it works

| Trigger | Fires on | Why |
| :--- | :--- | :--- |
| **Compaction** | `SessionStart`, `source: compact` | Claude Code's own summarization can drop rules from the compacted context. |
| **Resume** | `SessionStart`, `source: resume` | Same risk when picking a saved session back up. |
| **Depth** | `UserPromptSubmit` | Long sessions degrade adherence from raw context depth alone. seatbelt estimates transcript size and re-injects past a threshold (first at 100K tokens, then every 50K). |
| **Visible confirmation** | `systemMessage` alongside every fire | A one-line "reminded the agent of your rules" message, so you're not just trusting it happened silently. **VS Code caveat:** the VS Code extension doesn't render a `SessionStart` `systemMessage` in the chat panel ([anthropics/claude-code#15344](https://github.com/anthropics/claude-code/issues/15344), closed as "not planned"). It shows up in the plain CLI. The guard-match nudge is unaffected either way. |
| **Guard match** | `PreToolUse` (shell commands) | Catches the moment a command is about to run into a rule you flagged — even if the model has the rule in context and acts against it anyway. Surfaces a plain heads-up (`permissionDecision: "ask"`), never a block. Works for both Claude Code's `Bash` tool and its Windows `PowerShell` fallback. |

> **Why 100K tokens?** Measured adherence degradation starts around 50K–100K tokens and worsens sharply near 50% of the context window (roughly 100K for Claude Code's ~200K window). 100,000 sits right at the start of that zone, before the steep drop-off.
>
> **How "tokens" are estimated:** from the transcript file's raw size (~4 characters per token) — not a real token count, so treat `firstFire`/`interval` as "roughly this deep," not exact.

## Configuration

Optional. Drop a `.claude/seatbelt.json` in your project — every field has a sane default, and a typo in one never breaks the rest:

```json
{
  "firstFire": 100000,
  "interval": 50000,
  "mode": "auto",
  "maxInjectTokens": 1500,
  "minTurnsBetween": 10
}
```

| Field | Default | Description |
| :--- | :--- | :--- |
| `firstFire` | `100000` | Token depth for the first depth-triggered re-injection. |
| `interval` | `50000` | Tokens between subsequent re-injections. |
| `mode` | `"auto"` | `"auto"`: whole file if small, else marked block, else first 40 lines.<br>`"block"`: marked block only.<br>`"full"`: always the whole file. |
| `maxInjectTokens` | `1500` | Size budget `"auto"` mode checks against. |
| `minTurnsBetween` | `10` | Minimum turns between depth-triggered fires, so it can't spam your context. |

## What seatbelt is *not*

seatbelt used to try classifying which Bash commands were "dangerous" in general. It doesn't anymore, and here's the honest reason: two rounds of blind-tested detection work found recall on unfamiliar tools was unstable and ecosystem-dependent — **12% → 60% → 40%** across three independent holdout tests, even with 0% false positives. That's not a foundation to ship a safety claim on, so it was cut. The code lives on [`archive/enforcement`](https://github.com/dripston/seatbelt/tree/archive/enforcement) — nothing deleted, just not shipped.

The guard-match nudge is a narrower, different thing built after that: **zero classification**. It matches a command against a literal/wildcard pattern *you* wrote — no guessing, so no recall/precision number to fail.

Plainly:

- **Never blocks a command** — the guard-match nudge only ever emits `"ask"`, never `"deny"`.
- **Never detects "dangerous" content** — no opinion on anything that isn't an exact/wildcard match against a pattern you wrote.
- **Matches raw strings, not shells** — a command that hides the matching text behind piping, chaining, or `eval` may not match. For a nudge, a miss just means no reminder, not a security failure.
- **Is not a substitute for your own judgment** — a rule in context, or a nudge before a matching command, makes compliance more likely, not guaranteed.
- **Doesn't fix `AGENTS.md` truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug upstream.
- **Adds a small per-invocation cost** — a bounded transcript size check per prompt, a small file read/write per session event, a regex test per guarded rule per shell command.
- **Doesn't yet have a clean adherence measurement.** Re-injection is verified and tested for correctness. Whether it measurably improves rule-following at depth produced a null result in real test runs, not a clear signal either way — this is the mechanism the theory needs, proven correct, not proven effective.
- **Known rough edges, tracked openly:** the guard nudge currently re-asks on every matching command with no memory of a prior approval ([#1](https://github.com/dripston/seatbelt/issues/1)), and if a command matches more than one guarded rule, only the first is surfaced ([#2](https://github.com/dripston/seatbelt/issues/2)). Both are open for contribution.

## Prior art

[Cozempic](https://github.com/Ruya-AI/cozempic) does similar `SessionStart` reminders as part of a broader context-pruning tool. seatbelt stays narrower on purpose: four triggers, no command classification.

## Contributing

Issues and PRs welcome — [open issues](https://github.com/dripston/seatbelt/issues) are a good place to start. Run `node --test tests/*.test.js` before submitting.

## License

MIT
