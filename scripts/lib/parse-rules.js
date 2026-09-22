'use strict';

const fs = require('fs');
const path = require('path');

const CANDIDATE_FILES = [
  'CLAUDE.md',
  path.join('.claude', 'CLAUDE.md'),
  'AGENTS.md',
];

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
  try {
    for (const rel of CANDIDATE_FILES) {
      const abs = path.join(cwd, rel);
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
  CANDIDATE_FILES,
};
