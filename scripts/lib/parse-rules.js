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
const LINE_RE = /^\s*[-*]\s+(.*)$/;
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

/**
 * Finds and merges critical-block rules from all candidate files
 * under cwd. Guaranteed not to throw.
 * Returns { rules: [{text, guard}], sources: [absolutePathsFound] }
 */
function findAndParseRules(cwd) {
  const sources = [];
  const rules = [];
  const normalizedCwd = normalizeCwd(cwd);
  try {
    for (const rel of CANDIDATE_FILES) {
      const abs = path.join(normalizedCwd, rel);
      if (!fs.existsSync(abs)) continue;
      const content = readFileSafe(abs);
      const found = parseBlocksFromContent(content);
      if (found.length > 0) {
        sources.push(abs);
        rules.push(...found);
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
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    // Collapse runs of literal whitespace into \s+ so "git push" still
    // matches "git  push" (double space) or other incidental spacing.
    .map((part) => part.replace(/\s+/g, '\\s+'))
    .join('.*');
  return new RegExp(escaped, 'i');
}

module.exports = {
  parseBlocksFromContent,
  findAndParseRules,
  guardPatternToRegExp,
  normalizeCwd,
  CANDIDATE_FILES,
};
