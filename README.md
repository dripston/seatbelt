<div align="center">

# 🪢 seatbelt

**Keep your `CLAUDE.md` rules alive — across compaction, resume, and long sessions.**

[![version](https://img.shields.io/badge/version-0.3.0-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![tests](https://img.shields.io/badge/tests-126%2F126%20passing-brightgreen)](tests/)
[![scope](https://img.shields.io/badge/scope-reminder%2C%20not%20enforcer-orange)](#-limitations-what-seatbelt-is-not)

</div>

---

> Claude Code agents follow your `CLAUDE.md` / `AGENTS.md` rules at first, then silently drop them — after context compaction, on resume, or just from being deep in a long session. This is a real, documented gap ([see evidence](#-the-problem)).

**seatbelt does two things: it reminds, and it nudges.**
Reminding re-reads your rules and pushes them back into context at the three moments they're most likely to fall out. Nudging catches the moment a command is about to match a rule you explicitly flagged, and surfaces a plain heads-up before it runs. Neither one blocks anything or guesses what's "dangerous" — nudging only fires on a pattern you wrote yourself, word for word.

```text
                    ┌─────────────────────────────┐
   compaction  ───▶ │                             │
   resume      ───▶ │   your rules, re-injected   │ ───▶  agent sees them again
   deep context ──▶ │                             │
                    └─────────────────────────────┘

   your command  ──▶  matches a rule you flagged?  ──▶  "heads up" nudge, not a block
```

## 🚀 Quick Start

### Installation

```bash
claude plugin marketplace add dripston/seatbelt
claude plugin install seatbelt
```

*(Testing from a local clone instead of GitHub:)*
```bash
claude plugin marketplace add ./path/to/local/seatbelt
claude plugin install seatbelt
```

### Usage

Just write your rules the way you already do — **no special syntax required:**

```markdown
<!-- CLAUDE.md -->
- Never git push without asking me first.
- Never delete files in migrations/.
- Always run tests before committing.
```

By default, seatbelt re-injects the whole file when it's small, so most projects need zero setup. If your `CLAUDE.md` is large and you only want specific lines kept alive, you can wrap them:

```markdown
<!-- rule-guard:critical -->
- Never git push without asking me first.
<!-- /rule-guard:critical -->
```

Want a specific rule to also trigger a heads-up right before a matching command runs? Tag it with a guard pattern:

```markdown
<!-- rule-guard:critical -->
- Never push without asking me first. [guard: git push]
<!-- /rule-guard:critical -->
```

`*` is a wildcard. `[guard: rm * migrations/*]` matches any `rm` command touching `migrations/`. This is a literal/wildcard string match against the pattern you wrote — not a classifier, and not required. Unguarded rules never trigger a nudge; they're only ever re-injected.

**Monorepos work out of the box.** Running Claude Code from a subdirectory (`cd packages/api && claude`)? seatbelt walks up to your repo root to find `CLAUDE.md`, stopping at the first `.git` boundary — no config needed.

## ✨ How it Works

| Trigger | Fires on | Why |
| :--- | :--- | :--- |
| **Compaction** | `SessionStart`, `source: compact` | Claude Code's own summarization can drop rules from the compacted context. |
| **Resume** | `SessionStart`, `source: resume` | Same risk when picking a saved session back up. |
| **Depth** | `UserPromptSubmit` | A long session degrades adherence purely from context depth. seatbelt estimates transcript size and re-injects past a threshold (first at 100K tokens, then every 50K). |
| **Guard match** | `PreToolUse` (Bash only) | Addresses a different failure mode: the model can have a rule in context and still act against it. If a Bash command matches a `[guard: pattern]` you wrote, seatbelt surfaces a plain heads-up (`permissionDecision: "ask"`) naming the rule — never a block. Only fires for rules you explicitly tagged; unguarded rules are unaffected. |

> 💡 **Why 100K tokens?** Measured adherence degradation starts around 50K–100K tokens and worsens sharply near 50% of the context window (roughly 100K for Claude Code's ~200K window). 100,000 sits right at the start of that zone, before the steep part of the drop-off.
>
> **How "tokens" are estimated:** seatbelt doesn't call an API to count real tokens — it estimates from the transcript file's raw size (~4 characters per token), which includes tool-call payloads and JSON overhead, not just conversation text. It's a threshold heuristic, not a precise token count — treat `firstFire`/`interval` as "roughly this deep," not exact.

## ⚙️ Configuration

Optional. Drop a `.claude/seatbelt.json` in your project to customize behavior. Every field has a sane default, and a typo in one never breaks the rest:

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
| `minTurnsBetween` | `10` | Minimum turns between depth-triggered fires to prevent context spamming. |

## 🛑 Limitations: What seatbelt is *not*

seatbelt used to try classifying which Bash commands were "dangerous" in general. It doesn't anymore — here's the honest reason:

> Two rounds of real, blind-tested detection work found recall on unfamiliar tools was unstable and ecosystem-dependent — **12% → 60% → 40%** across three independent holdout tests, even while false positives stayed at 0%. That's not a foundation to ship a safety claim on, so it was cut. The code is preserved on [`archive/enforcement`](https://github.com/dripston/seatbelt/tree/archive/enforcement) — nothing deleted, just not shipped.

The `PreToolUse` guard-match nudge added later is a deliberately narrower, different thing: it does **zero classification**. It only matches a Bash command against a literal/wildcard pattern *you* wrote yourself in a `[guard: ...]` tag — there's no guessing at what's risky, so there's no recall/precision number to fail. If you don't tag a rule with a guard pattern, it can never trigger a nudge; it's only ever re-injected.

So, plainly:

- **Does not block any command, ever** — the guard-match nudge only ever emits `"ask"` (a visible heads-up), never `"deny"`.
- **Does not detect "dangerous" content** — it has no opinion on any command that isn't an exact/wildcard match against a pattern you wrote.
- **The guard-match nudge does raw string matching, not shell parsing** — a command that hides the matching text behind piping, chaining, or `eval` may not match. For a nudge, a missed match just means no reminder, not a security failure — this is a deliberate simplification, not an oversight (see [`archive/enforcement`](https://github.com/dripston/seatbelt/tree/archive/enforcement) for the more complex tokenizing pipeline this intentionally does *not* reuse).
- **Is not a substitute for your own judgment** — a rule in context, or a nudge before a matching command, makes the model more likely to comply, not guaranteed to.
- **Does not fix `AGENTS.md` truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug.
- **Adds a small per-invocation cost** (a bounded transcript size check per prompt, a small file read/write per session event, a regex test per guarded rule per Bash command).
- **The adherence benefit of re-injection is not yet confirmed by a clean measurement.** Re-injecting the text is verified and tested; whether it measurably improves rule-following at depth is not — real test runs produced a null result rather than a clear signal either way. If you need proof it changes model behavior, this isn't that yet — it's the mechanism the theory needs, tested for correctness, not for effect size.

## 📖 The Problem

This tool is built on a documented, still-open gap in Claude Code:

- [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) — re-injection feature request, 7 prior duplicate reports, plus a dose-response report of adherence decaying with raw context depth.
- [anthropics/claude-code#88565](https://github.com/anthropics/claude-code/issues/88565) — auto mode routes edits through Bash, bypassing rule injection.
- [anthropics/claude-code#81999](https://github.com/anthropics/claude-code/issues/81999) — agent breaks an explicit "every time, no exceptions" rule after a few cycles.
- [anthropics/claude-code#34197](https://github.com/anthropics/claude-code/issues/34197), [#43716](https://github.com/anthropics/claude-code/issues/43716) — CLAUDE.md ignored in long sessions.

## 🔍 Prior Art

[Cozempic](https://github.com/Ruya-AI/cozempic) does similar `SessionStart` reminders as part of a broader context-pruning tool. seatbelt is narrower on purpose: four triggers, no command classification.

## 🤝 Contributing

Issues and PRs welcome! Please run `node --test tests/*.test.js` before submitting.

## 📄 License

MIT
