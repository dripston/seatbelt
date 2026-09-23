'use strict';

// Built-in risky command patterns: always "ask" even if the user wrote no
// explicit guard rule for them. Kept as an array of {label, re} so reasons
// can name the exact thing that matched.
// Matches "git" followed eventually by "push", tolerating flags/args in
// between (e.g. "git -C repo push", "git --no-pager push"), by allowing
// any characters between the two words rather than requiring them
// adjacent. All patterns use the `s` (dotAll) flag so `.` also matches
// embedded newlines (e.g. a backslash line-continuation between "git"
// and "push") — without it, `.` stops at a literal \n and a command
// split across lines silently evades detection. Fixed in the fix-pass
// (was a real, confirmed bug; see evals/results/VERDICT.md).
const BUILTIN_RISKY = [
  { label: 'git push', re: /\bgit\b(?:(?!--dry-run).)*?\bpush\b(?!.*--dry-run)/is },
  { label: 'git push --force / -f', re: /\bgit\b.*?\bpush\b.*\s(--force|-f)\b/is },
  { label: 'git reset --hard', re: /\bgit\b.*?\breset\b.*--hard\b/is },
  { label: 'git clean -f', re: /\bgit\b.*?\bclean\b.*-f/is },
  { label: 'git branch -D', re: /\bgit\b.*?\bbranch\b.*-D\b/is },
  { label: 'rm -rf', re: /\brm\s+.*-[a-z]*r[a-z]*f|\brm\s+.*-[a-z]*f[a-z]*r/is },
  { label: 'git checkout -- .', re: /\bgit\b.*?\bcheckout\b\s+--\s+\.\b/is },
  { label: 'vercel --prod', re: /\bvercel\b.*--prod\b/is },
  { label: 'firebase deploy', re: /\bfirebase\s+deploy\b/is },
  { label: 'kubectl apply', re: /\bkubectl\s+apply\b/is },
  { label: 'terraform apply', re: /\bterraform\s+apply\b/is },
];

function loadConfiguredRisky(cwd) {
  const fs = require('fs');
  const path = require('path');
  const { normalizeCwd } = require('./lib/parse-rules');
  const configPath = path.join(normalizeCwd(cwd), 'rule-guard.config.json');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.riskyCommands)) return null;
    return parsed.riskyCommands
      .filter((s) => typeof s === 'string' && s.length > 0)
      .map((s) => ({
        label: s,
        re: new RegExp(s.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'is'),
      }));
  } catch (_err) {
    // Fail open: bad config means fall back to built-in list, never crash.
    return null;
  }
}

/**
 * Returns the built-in risky list, optionally overridden by a project
 * config file. Never throws.
 */
function getRiskyCommands(cwd) {
  const configured = loadConfiguredRisky(cwd);
  return configured || BUILTIN_RISKY;
}

module.exports = { BUILTIN_RISKY, getRiskyCommands };
