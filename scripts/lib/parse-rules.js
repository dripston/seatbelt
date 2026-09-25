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
// Claude Code's actual hook input in practice (Claude Code always
// normalizes cwd to native Windows form before sending it to hooks, per
// live-captured hook input), but handled defensively here in case
// scripts are invoked directly (e.g. manual testing, a different
// terminal, a future Claude Code version) with a POSIX-style cwd.
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
// real, silent failure before this was added: a subdirectory cwd found 0
// rules even though the parent directory had a valid CLAUDE.md. Capped
// rather than unbounded so a pathological/unusual cwd (e.g. a very deep
// path, or one with no filesystem root reachable for some reason) can't
// cause an unbounded loop; stops early at a directory containing `.git`
// (the repo boundary) or the filesystem root, whichever comes first.
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
 * Finds the nearest candidate rules file, searching cwd first and then
 * walking upward toward a repo boundary or MAX_UPWARD_LEVELS (same
 * traversal as findAllRulesFiles, so a subdirectory session still finds
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
  findRulesFile,
  findAllRulesFiles,
  collectSearchDirs,
  normalizeCwd,
  CANDIDATE_FILES,
  MAX_UPWARD_LEVELS,
};
