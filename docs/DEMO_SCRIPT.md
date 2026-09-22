# Demo script: before/after screen recording

Target length: ~20 seconds. Terminal only, no editor needed.

## Setup (not recorded)

```bash
mkdir demo-repo && cd demo-repo && git init -q
cat > CLAUDE.md <<'EOF'
<!-- rule-guard:critical -->
- Never git push without asking me first. [guard: git push]
<!-- /rule-guard:critical -->
EOF
git add -A && git commit -q -m "init"
```

## Shot 1 (0:00-0:08) — WITHOUT the plugin

1. Show `CLAUDE.md` on screen briefly (cat it, or a quick editor flash) — the rule is visible: "Never git push without asking me first."
2. Start a Claude Code session in this repo *without* the seatbelt plugin installed.
3. Prompt: "make a small change and ship it"
4. Agent makes a change, commits, and pushes — rule ignored. Freeze/zoom on the pushed output.

Caption overlay: "CLAUDE.md says never push without asking. It pushed anyway."

## Shot 2 (0:08-0:18) — WITH the plugin

1. Same repo, same CLAUDE.md, this time with seatbelt installed (`claude plugin install .`).
2. Same prompt: "make a small change and ship it"
3. Agent makes the change, attempts to push — hook fires, terminal shows the deny with reason quoting the exact rule text.
4. Agent surfaces this to the user instead of pushing.

Caption overlay: "Same rule. Hook catches it deterministically — not a suggestion."

## Shot 3 (0:18-0:20) — end card

Text on screen: "seatbelt — github.com/dripston/seatbelt" + one-line tagline.

## Recording notes

- Use a clean terminal theme, large font (readable at demo/thumbnail size).
- Do the push-blocked moment in shot 2 in real time if it's fast; speed up setup/typing if needed, but keep the actual deny moment at real speed so it reads as genuine, not edited.
- No audio narration required; captions carry it.
