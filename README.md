<div align="center">

# 🪢 seatbelt

**Keep your `CLAUDE.md` rules alive — across compaction, resume, and long sessions.**

[![version](https://img.shields.io/badge/version-0.2.0-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![tests](https://img.shields.io/badge/tests-90%2F90%20passing-brightgreen)](tests/)
[![scope](https://img.shields.io/badge/scope-reminder%2C%20not%20enforcer-orange)](docs/ARCHITECTURE_DECISION.md)

</div>

---

> Claude Code agents follow your `CLAUDE.md` / `AGENTS.md` rules at first, then silently drop them — after context compaction, on resume, or just from being deep in a long session. This is a real, documented gap ([see evidence](#-the-problem)).

**seatbelt fixes the "silently drop" part.** 
It re-reads your rules and pushes them back into context at the three moments they're most likely to fall out. That's the whole product. It does not scan your commands, does not block anything, and does not try to guess what's dangerous.

```text
                    ┌─────────────────────────────┐
   compaction  ───▶ │                             │
   resume      ───▶ │   your rules, re-injected   │ ───▶  agent sees them again
   deep context ──▶ │                             │
                    └─────────────────────────────┘
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

## ✨ How it Works

| Trigger | Fires on | Why |
| :--- | :--- | :--- |
| **Compaction** | `SessionStart`, `source: compact` | Claude Code's own summarization can drop rules from the compacted context. |
| **Resume** | `SessionStart`, `source: resume` | Same risk when picking a saved session back up. |
| **Depth** | `UserPromptSubmit` | A long session degrades adherence purely from context depth. seatbelt estimates transcript size and re-injects past a threshold (first at 100K tokens, then every 50K). |

> 💡 **Why 100K tokens?** Measured adherence degradation starts around 50K–100K tokens and worsens sharply near 50% of the context window. 100,000 sits right at the start of that zone. Full reasoning in [docs/DESIGN.md](docs/DESIGN.md).

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

- **Does not block or check any command** — no `PreToolUse` hook, no deny, no ask.
- **Does not detect "dangerous" content** — no opinion on command content at all.
- **Is not a substitute for your own judgment** — a rule in context is more likely to be followed, not guaranteed to be.
- **Does not fix `AGENTS.md` truncation** on very long files ([openai/codex#13386](https://github.com/openai/codex/issues/13386)) — that's a model-context bug.
- **Adds a small per-invocation cost** (a bounded transcript size check per prompt, a small file read/write per session event).

## 📖 The Problem

This tool is built on a documented, still-open gap in Claude Code:

- [anthropics/claude-code#92257](https://github.com/anthropics/claude-code/issues/92257) — re-injection feature request, 7 prior duplicate reports, plus a dose-response report of adherence decaying with raw context depth.
- [anthropics/claude-code#88565](https://github.com/anthropics/claude-code/issues/88565) — auto mode routes edits through Bash, bypassing rule injection.
- [anthropics/claude-code#81999](https://github.com/anthropics/claude-code/issues/81999) — agent breaks an explicit "every time, no exceptions" rule after a few cycles.
- [anthropics/claude-code#34197](https://github.com/anthropics/claude-code/issues/34197), [#43716](https://github.com/anthropics/claude-code/issues/43716) — CLAUDE.md ignored in long sessions.

*(Full log: [docs/EVIDENCE.md](docs/EVIDENCE.md))*

## 🔍 Prior Art

[Cozempic](https://github.com/Ruya-AI/cozempic) does similar `SessionStart` reminders as part of a broader context-pruning tool. seatbelt is narrower on purpose: three triggers, nothing else.

## 🤝 Contributing

Issues and PRs welcome! Please run `node --test tests/*.test.js` before submitting.

## 📄 License

MIT
