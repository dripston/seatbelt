'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CANDIDATE_FILES = [
  'CLAUDE.md',
  path.join('.claude', 'CLAUDE.md'),
  'AGENTS.md',
];

// Matches a Git-Bash/MSYS-style POSIX mount path on Windows, e.g. "/d/foo"
// or "/c/Users/x" — the drive letter is the single character right after
// the leading slash. This form is NOT accepted as absolute by Node's
// path.join on win32 (it gets treated as drive-relative), which silently
// produces a wrong, usually-nonexistent path. Confirmed unreachable via
// Claude Code's actual hook input in practice (see docs/HOOK_INPUT_EVIDENCE.md
// — Claude Code always normalizes cwd to native Windows form before sending
// it to hooks), but handled defensively here in case scripts are invoked
// directly (e.g. manual testing, a different terminal, a future Claude
// Code version) with a POSIX-style cwd.
const POSIX_MOUNT_RE = /^\/([a-zA-Z])(\/.*)?$/;

/**
 * Normalizes a cwd string so path.join behaves correctly on win32, without
 * changing behavior on other platforms. Never throws; returns the input
 * unchanged if it doesn't look like a path this function needs to fix.
 */
function normalizeCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return cwd;
  if (os.platform() !== 'win32') return cwd;

  const match = POSIX_MOUNT_RE.exec(cwd);
  if (!match) return cwd;

  const driveLetter = match[1].toUpperCase();
  const rest = (match[2] || '').replace(/\//g, '\\');
  return `${driveLetter}:${rest || '\\'}`;
}

const BLOCK_RE = /<!--\s*rule-guard:critical\s*-->([\s\S]*?)<!--\s*\/rule-guard:critical\s*-->/g;
const LINE_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const GUARD_TAG_RE = /\[guard:\s*(.+?)\s*\]\s*$/;

/**
 * Extracts critical-block rules from a single markdown string.
 * Never throws: malformed content just yields fewer/no rules.
 */
function parseBlocksFromContent(content) {
  const rules = [];
  if (typeof content !== 'string' || content.length === 0) return rules;

  let match;
  BLOCK_RE.lastIndex = 0;
  while ((match = BLOCK_RE.exec(content)) !== null) {
    const blockBody = match[1];
    const lines = blockBody.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
      const lineMatch = LINE_RE.exec(rawLine);
      if (!lineMatch) continue;
      const text = lineMatch[1].trim();
      if (!text) continue;

      const guardMatch = GUARD_TAG_RE.exec(text);
      if (guardMatch) {
        const ruleText = text.slice(0, guardMatch.index).trim();
        rules.push({ text: ruleText, guard: guardMatch[1].trim() });
      } else {
        rules.push({ text, guard: null });
      }
    }
  }
  return rules;
}

/**
 * Reads a single candidate file safely. Returns '' on any error
 * (missing file, permission denied, etc.) rather than throwing.
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_err) {
    return '';
  }
}

// How many parent directories to walk upward looking for a rules file,
// so a session started in a monorepo subdirectory (e.g. `packages/api`)
// still finds rules declared at the repo root. Reproduced directly as a
// real, silent failure before this was added: findAndParseRules found 0
// rules from a subdirectory even though the parent directory had a
// valid CLAUDE.md. Capped rather than unbounded so a pathological/
// unusual cwd (e.g. a very deep path, or one with no filesystem root
// reachable for some reason) can't cause an unbounded loop; stops early
// at a directory containing `.git` (the repo boundary) or the
// filesystem root, whichever comes first.
const MAX_UPWARD_LEVELS = 10;

/**
 * Walks upward from `startDir` (inclusive) toward the filesystem root,
 * yielding each directory to check for rules files. Stops after finding
 * a `.git` directory/file (repo boundary, inclusive of that directory)
 * or after MAX_UPWARD_LEVELS, whichever comes first. Never throws.
 */
function collectSearchDirs(startDir) {
  const dirs = [];
  let current = startDir;
  for (let i = 0; i < MAX_UPWARD_LEVELS; i++) {
    dirs.push(current);
    let hasGitBoundary = false;
    try {
      hasGitBoundary = fs.existsSync(path.join(current, '.git'));
    } catch (_err) {
      hasGitBoundary = false;
    }
    if (hasGitBoundary) break;
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return dirs;
}

/**
 * Finds and merges critical-block rules from all candidate files under
 * cwd AND each parent directory up to a repo boundary (a directory
 * containing `.git`) or MAX_UPWARD_LEVELS, whichever comes first. This
 * is what makes rules declared at a repo root visible to a session
 * started in a subdirectory (e.g. a monorepo's packages/api). Guaranteed
 * not to throw. Returns { rules: [{text, guard}], sources: [absolutePathsFound] }
 */
function findAndParseRules(cwd) {
  const sources = [];
  const rules = [];
  const normalizedCwd = normalizeCwd(cwd);
  try {
    const searchDirs = collectSearchDirs(normalizedCwd);
    for (const dir of searchDirs) {
      for (const rel of CANDIDATE_FILES) {
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs)) continue;
        const content = readFileSafe(abs);
        const found = parseBlocksFromContent(content);
        if (found.length > 0) {
          sources.push(abs);
          rules.push(...found);
        }
      }
    }
  } catch (_err) {
    // Fail open: any unexpected error yields no rules, never a crash.
    return { rules: [], sources: [] };
  }

  // Startup sanity check: if a CLAUDE.md/AGENTS.md exists but has no
  // recognized critical block, or the directory couldn't be resolved at
  // all, warn to stderr rather than silently doing nothing. A silent
  // no-op (rules the user thinks are active but aren't) is the worst
  // failure mode this tool can have — worse than a false positive, since
  // a false positive is at least visible.
  if (rules.length === 0) {
    try {
      const anyFileExists = CANDIDATE_FILES.some((rel) => fs.existsSync(path.join(normalizedCwd, rel)));
      if (anyFileExists) {
        process.stderr.write(
          'rule-guard: found a CLAUDE.md/AGENTS.md file but no <!-- rule-guard:critical --> block was recognized in it. Rules are NOT active for this session. Check the block syntax in README.md.\n'
        );
      }
    } catch (_e) {
      // best-effort warning only; never let this throw
    }
  }

  return { rules, sources };
}

/**
 * Converts a guard pattern like "git push" or "rm * migrations/*"
 * into a RegExp. '*' becomes a wildcard matching any characters
 * (including none); everything else is escaped literally.
 */
function guardPatternToRegExp(pattern) {
  const escaped = pattern
    .split('*')
    // Trim each segment before escaping: a pattern like "rm * migrations/*"
    // has a leading space on " migrations/" purely to separate it from the
    // '*' in the source text — that space is already implied by the
    // wildcard's own '.*' (which can match zero-or-more characters,
    // including a space or nothing at all). Without trimming, that literal
    // leading/trailing space becomes an ADDITIONAL mandatory \s+ requirement
    // stacked next to the wildcard, so "rm migrations/x" (no flags, just
    // one space between "rm" and "migrations/") fails to match because the
    // regex demands two separate whitespace gaps. This was a real,
    // confirmed bug (see PROGRESS.md fix-pass Phase 3).
    .map((part) => part.trim())
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    // Collapse runs of literal whitespace into a class that tolerates
    // incidental spacing variations: repeated/tab/newline whitespace
    // ("git  push"), and a Bash backslash line-continuation ("git\" +
    // newline + "push", where a literal backslash sits between the word
    // and the newline). \\?\s+ matches an optional backslash followed by
    // one or more whitespace characters.
    .map((part) => part.replace(/\s+/g, '\\\\?\\s+'))
    .join('.*');
  // 's' (dotAll) flag: '.' must also match embedded newlines, otherwise a
  // command split across lines (e.g. a backslash line-continuation)
  // silently evades a guard pattern. Fixed in the fix-pass (was a real,
  // confirmed bug; see evals/results/VERDICT.md).
  return new RegExp(escaped, 'is');
}

/**
 * Finds the nearest candidate rules file, searching cwd first and then
 * walking upward toward a repo boundary or MAX_UPWARD_LEVELS (same
 * traversal as findAndParseRules, so a subdirectory session still finds
 * a root-level CLAUDE.md). Within a single directory, checks CLAUDE.md,
 * then .claude/CLAUDE.md, then AGENTS.md. Returns { path, content } for
 * the first match, or null if none exist anywhere in the search path.
 * Used by auto-mode's "full" path in content-mode selection
 * (scripts/lib/select-content.js). Never throws.
 */
function findRulesFile(cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  try {
    const searchDirs = collectSearchDirs(normalizedCwd);
    for (const dir of searchDirs) {
      for (const rel of CANDIDATE_FILES) {
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs)) continue;
        const content = readFileSafe(abs);
        if (content) return { path: abs, content };
      }
    }
  } catch (_err) {
    return null;
  }
  return null;
}

/**
 * Returns ALL candidate rules files that exist under cwd or any parent
 * directory up to a repo boundary or MAX_UPWARD_LEVELS, each with their
 * raw content and absolute path, nearest-first. Used by block-mode and
 * auto-mode's block fallback to merge critical rules from every
 * CLAUDE.md/.claude/CLAUDE.md/AGENTS.md found in the search path, not
 * just the first file in the nearest directory. Never throws.
 */
function findAllRulesFiles(cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  const results = [];
  try {
    const searchDirs = collectSearchDirs(normalizedCwd);
    for (const dir of searchDirs) {
      for (const rel of CANDIDATE_FILES) {
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs)) continue;
        const content = readFileSafe(abs);
        if (content) results.push({ path: abs, content });
      }
    }
  } catch (_err) {
    return results;
  }
  return results;
}

module.exports = {
  parseBlocksFromContent,
  findAndParseRules,
  findRulesFile,
  findAllRulesFiles,
  collectSearchDirs,
  guardPatternToRegExp,
  normalizeCwd,
  CANDIDATE_FILES,
  MAX_UPWARD_LEVELS,
};
