'use strict';

// Built-in risky command patterns: always "ask" even if the user wrote no
// explicit guard rule for them. Kept as an array of {label, re} so reasons
// can name the exact thing that matched. Grouped by category (fix-pass
// Phase 3) so users reading/configuring this file can find and override a
// whole category at once via rule-guard.config.json.
//
// Default stance: everything on this built-in list produces "ask", never
// "deny" — a hard deny is reserved for a user's own guard-tagged rule in
// their CLAUDE.md/AGENTS.md (see pre-bash.js), because we should only ever
// refuse outright what someone explicitly told us to refuse. This list is
// a safety net for things the user probably didn't think to write a rule
// for, not a claim that we know better than them.
//
// All patterns use the `s` (dotAll) flag so `.` also matches embedded
// newlines (e.g. a backslash line-continuation between two words of a
// command) — without it, `.` stops at a literal \n and a command split
// across lines silently evades detection. Fixed in the fix-pass (was a
// real, confirmed bug; see evals/results/VERDICT.md).
//
// Every addition below maps to a specific row that failed in the fix
// pass's Phase 1 baseline (evals/results/REPORT.md) — no speculative
// categories were added beyond what the eval proved missing.
const BUILTIN_RISKY = [
  // --- Git history/remote mutation ---
  { label: 'git push', re: /\bgit\b(?:(?!--dry-run).)*?\bpush\b(?!.*--dry-run)/is },
  { label: 'git push --force / -f', re: /\bgit\b.*?\bpush\b.*\s(--force|-f)\b/is },
  { label: 'git reset --hard', re: /\bgit\b.*?\breset\b.*--hard\b/is },
  { label: 'git clean -f', re: /\bgit\b.*?\bclean\b.*-f/is },
  { label: 'git branch -D', re: /\bgit\b.*?\bbranch\b.*-D\b/is },
  { label: 'git checkout -- .', re: /\bgit\b.*?\bcheckout\b\s+--\s+\./is },
  // --- Git working-tree destruction ---
  { label: 'git restore .', re: /\bgit\b.*?\brestore\b.*\.\s*$/is },
  { label: 'git stash drop/clear', re: /\bgit\b.*?\bstash\b.*?\b(drop|clear)\b/is },
  { label: 'git rebase --abort/force variants', re: /\bgit\b.*?\brebase\b.*?(--abort|--force)/is },
  { label: 'git filter-branch', re: /\bgit\b.*?\bfilter-branch\b/is },

  // --- Publish/release: pushing an artifact somewhere public/irreversible ---
  { label: 'npm/yarn/pnpm publish', re: /\b(npm|yarn|pnpm)\b.*?\bpublish\b/is },
  { label: 'twine upload', re: /\btwine\b.*?\bupload\b/is },
  { label: 'cargo publish', re: /\bcargo\b.*?\bpublish\b/is },
  { label: 'gem push', re: /\bgem\b.*?\bpush\b/is },
  { label: 'docker push', re: /\bdocker\b.*?\bpush\b/is },

  // --- Infra destroy: cloud/database resources, hard to undo ---
  { label: 'terraform destroy', re: /\bterraform\b.*?\bdestroy\b/is },
  { label: 'terraform apply', re: /\bterraform\b.*?\bapply\b/is },
  { label: 'kubectl delete', re: /\bkubectl\b.*?\bdelete\b/is },
  { label: 'kubectl apply', re: /\bkubectl\b.*?\bapply\b/is },
  { label: 'aws destructive delete/rm', re: /\baws\b.*?\b(s3\s+rm\b.*?--recursive|rds\s+delete-db-instance|ec2\s+terminate-instances)\b/is },
  { label: 'gcloud delete', re: /\bgcloud\b.*?\bdelete\b/is },
  { label: 'az delete', re: /\baz\b.*?\bdelete\b/is },
  { label: 'dropdb / DROP DATABASE|TABLE', re: /\bdropdb\b|\bDROP\s+(DATABASE|TABLE)\b/is },
  { label: 'heroku pg:reset', re: /\bheroku\b.*?\bpg:reset\b/is },
  { label: 'vercel --prod', re: /\bvercel\b.*--prod\b/is },
  { label: 'firebase deploy', re: /\bfirebase\s+deploy\b/is },
  { label: 'docker system prune', re: /\bdocker\b.*?\bsystem\b.*?\bprune\b/is },

  // --- System: process/permission/power operations with wide blast radius ---
  { label: 'shutdown/reboot', re: /\bshutdown\b|\breboot\b/is },
  { label: 'kill -9 (pid 1 or broad)', re: /\bkill\b.*?-9\b/is },
  { label: 'chmod -R 777 on a broad/system path', re: /\bchmod\b.*?-R\b.*?777\b.*?(\s\/(\s|$)|\/etc\b|\/usr\b|\/bin\b)/is },
  { label: 'dd to a device', re: /\bdd\b.*?\bof=\/dev\//is },
  { label: 'mkfs', re: /\bmkfs(\.\w+)?\b/is },
  { label: 'systemctl stop (production-named service)', re: /\bsystemctl\b.*?\bstop\b.*?\bprod/is },

  // --- Filesystem destructive: bulk/irreversible file removal ---
  { label: 'rm -rf', re: /\brm\s+.*-[a-z]*r[a-z]*f|\brm\s+.*-[a-z]*f[a-z]*r/is },
  { label: 'find with -delete or -exec rm', re: /\bfind\b.*?(-delete\b|-exec\s+rm\b)/is },
  { label: 'truncate', re: /\btruncate\b.*?-s\s*0\b/is },
  { label: 'shred', re: /\bshred\b/is },
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
