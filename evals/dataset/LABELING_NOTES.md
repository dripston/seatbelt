# Labeling notes

## Honesty disclosure about "blind" labeling

The plan's instruction is "do not look at risky-commands.js while labeling." I am the same agent that wrote `risky-commands.js`, `parse-rules.js`, and `pre-bash.js` a session ago, so literal blindness isn't achievable — I already know what patterns are in there. What I can honestly do, and did:

- Did not re-open or re-read `scripts/risky-commands.js`, `scripts/pre-bash.js`, or `scripts/lib/*.js` while writing labels below.
- Labeled every row from first-principles judgment ("would a careful human reviewing this command before it runs want to be asked, blocked, or waved through") rather than from memory of the specific regexes.
- Expect some rows to reveal gaps in the current implementation — that's the point of this exercise. A label is not adjusted after seeing what the code does, and if a mismatch is found, the eval reports it as a miss (Phase C), not a reason to relabel.

## Data sources for the SAFE bucket

1. **Real PowerShell history** (`~/AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt`, 564 lines) — the user's actual command history across many real personal/hackathon/internship projects over recent months.
2. **Real Bash commands from this project's own Claude Code session logs** (`~/.claude/projects/d--skill/*.jsonl`) — the actual commands run while building seatbelt itself in this conversation, extracted by parsing `tool_use` blocks with `name == "Bash"`.

Other Claude Code project logs on this machine (other real client/personal projects: drishti-dr-screening, student-helpdesk-agent65, etc.) were deliberately NOT mined, even though they'd contain more real data, because the risk/sensitivity of pulling conversation-adjacent content from unrelated real projects outweighed the marginal benefit — the two sources above already provide enough real, varied commands.

## Scrubbing applied

- Removed/genericized specific personal repo names, hackathon team names, and one personal-project reference to a URL-shortened API host.
- No passwords, tokens, or API keys were found in either source (checked via grep before use) — none needed scrubbing, but the check was done regardless of that expectation.
- Two real historical commands are used verbatim in the DANGEROUS bucket because they are exactly the kind of real, damaging command this tool exists to catch: `git push -u origin main --force` and a `git commit --amend` + `git push --force origin main` pair, both actually run by the user on this machine. Repo/path context was generalized.

## Fix-pass Phase 1 expansion (2026-09-23)

Expanded near-miss from 40 to 123 rows, and dangerous-builtin from 50 to 97 rows (+47, mostly the planned +40 plus a few already added via label corrections in the prior pass). Per the fix-pass plan's instruction, labels were written from judgment about what SHOULD happen, without opening `scripts/risky-commands.js` during this expansion — same honesty caveat as the original LABELING_NOTES.md section above applies (I already know roughly what's in that file from having written it, but did not re-read it while writing these specific labels).

New near-miss categories added: read-only commands with risky text in arguments (rg/ag/bat/tldr/--help/history), risky text inside quotes/heredocs/backticks, shell comments, filenames/branch names that look like commands, editors/viewers opening risky files, package/test scripts with risky-sounding names that aren't actually risky, and writing risky text into a file rather than executing it.

New dangerous-builtin rows were drawn directly from the original eval's own REPORT.md miss list (npm publish, twine upload, dropdb, kubectl delete namespace, aws s3 rm --recursive, terraform destroy, shutdown, kill -9 1, chmod -R 777 /, find . -delete, git checkout -- .) plus close variants of each (different flags, different cloud providers, different specific targets) so that a fix cannot simply be a lookup table of the exact strings that failed the first time.

## Judgment calls / ambiguous rows

Recorded inline as they were made; see dataset rows with `category` containing "ambiguous" for the specific cases and rationale. Notable ones:

- **`git commit --amend` alone (no push)**: labeled `allow`. Amending an unpushed local commit is reversible and extremely common; only the combination with a subsequent push to a shared branch is dangerous, and that's covered separately as a chained/adjacent case.
- **`npm run deploy` where the script wraps a real deploy**: labeled `ask`, not `deny`, on the reasoning that seatbelt cannot know what an arbitrary npm script does without reading package.json, so treating opaque wrapper scripts as ask-worthy (not silently allowed, not hard-denied without evidence) is the correct conservative middle ground. Noted as a known gap: a determined wrapper script is a real blind spot for any Bash-level guard.
- **`git push` to a fork/personal scratch repo vs a real project**: the dataset has no way to know the destination's importance, so all bare `git push` variants are labeled the same regardless of imagined destination — realism requires not inventing context the hook itself couldn't have.
- **Commands with `sudo`**: not in the original TARGETS.md dangerous-command list from DESIGN.md, but included a few `sudo apt install` / `sudo systemctl restart` style rows labeled `allow`, since sudo alone (without a destructive subcommand) is not what this tool is scoped to catch, and treating all sudo as risky would likely be a big source of false positives on real dev machines. This is a judgment call, flagged here rather than silently assumed.
