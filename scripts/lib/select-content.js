'use strict';

const { findRulesFile, findAllRulesFiles, parseBlocksFromContent } = require('./parse-rules');

// ~4 chars per token: a coarse but dependency-free estimate, adequate for
// a threshold decision (not for exact billing/context math).
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function rulesToText(rules) {
  return rules.map((r) => `- ${r.text}`).join('\n');
}

// Patterns that strongly suggest a line is a rule or directive.
const RULE_LINE_RE = /^\s*(?:[-*+]|\d+\.)\s+\S|^#{1,3}\s+\S/;

/**
 * Smarter truncation fallback for large files with no critical block.
 * Instead of blindly returning the first N lines, this finds the region
 * of the file with the highest density of list-item / heading lines
 * (which is where rules are most likely to live) and returns a window
 * around that region. Falls back to the first N lines if no rule-like
 * content is found at all.
 *
 * @param {string} content  raw file text
 * @param {number} maxLines max lines to include in the result
 * @returns {string}
 */
function smartTruncate(content, maxLines) {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length <= maxLines) return content;

  // Score each line: 1 if it looks like a rule, 0 otherwise.
  const scores = lines.map((l) => (RULE_LINE_RE.test(l) ? 1 : 0));

  // Sliding window of width maxLines: find the window with the most rule lines.
  let windowScore = scores.slice(0, maxLines).reduce((a, b) => a + b, 0);
  let bestScore = windowScore;
  let bestStart = 0;

  for (let i = 1; i <= lines.length - maxLines; i++) {
    windowScore += scores[i + maxLines - 1] - scores[i - 1];
    if (windowScore > bestScore) {
      bestScore = windowScore;
      bestStart = i;
    }
  }

  // If the best window has zero rule lines, fall back to the top of the file
  // so the user at least gets something meaningful.
  const start = bestScore > 0 ? bestStart : 0;
  const head = lines.slice(start, start + maxLines).join('\n');
  const note =
    start > 0
      ? `[... showing lines ${start + 1}–${start + maxLines} of ${lines.length} (densest rule section) ...]`
      : `[... truncated: full file has ${lines.length} lines, showing first ${maxLines} ...]`;
  return `${head}\n\n${note}`;
}

const DEFAULT_FIRST_LINES = 40;

/**
 * Selects what to re-inject for a given cwd and mode. Returns
 * { text, source } where source describes what was used ('block',
 * 'full', 'first-lines', or null), or { text: null, source: null } if
 * nothing should be injected. Never throws.
 *
 * Fix #2: 'block' mode and the critical-block fallback in 'auto' mode now
 * merge blocks from ALL candidate files (CLAUDE.md + .claude/CLAUDE.md +
 * AGENTS.md) instead of stopping at the first file found.
 *
 * Modes:
 * - 'block': only the marked <!-- rule-guard:critical --> blocks from all
 *   candidate files. Nothing if no block exists in any file.
 * - 'full': the entire content of all candidate files, joined with a
 *   separator. Nothing if no files exist.
 * - 'auto': full content if under maxInjectTokens; otherwise the critical
 *   blocks if any exist; otherwise the first DEFAULT_FIRST_LINES lines of
 *   the primary file plus a truncation note. Nothing if no file exists.
 */
function selectContent(cwd, mode, maxInjectTokens) {
  try {
    if (mode === 'block') {
      // Merge critical blocks from every candidate file.
      const allFiles = findAllRulesFiles(cwd);
      if (allFiles.length === 0) return { text: null, source: null };
      const allRules = allFiles.flatMap((f) => parseBlocksFromContent(f.content));
      if (allRules.length === 0) return { text: null, source: null };
      return { text: rulesToText(allRules), source: 'block' };
    }

    if (mode === 'full') {
      const allFiles = findAllRulesFiles(cwd);
      if (allFiles.length === 0) return { text: null, source: null };
      const combined = allFiles.map((f) => f.content.trim()).join('\n\n---\n\n');
      return { text: combined, source: 'full' };
    }

    // auto (default) — for backwards compat, 'full' injection still uses
    // the primary file only to avoid blowing the budget unexpectedly when
    // the combined content is still small. Block fallback merges all files.
    const found = findRulesFile(cwd);
    if (!found) return { text: null, source: null };

    const budget = typeof maxInjectTokens === 'number' && maxInjectTokens > 0 ? maxInjectTokens : 1500;
    if (estimateTokens(found.content) <= budget) {
      return { text: found.content.trim(), source: 'full' };
    }

    // Over budget — try merged critical blocks from all files.
    const allFiles = findAllRulesFiles(cwd);
    const allRules = allFiles.flatMap((f) => parseBlocksFromContent(f.content));
    if (allRules.length > 0) {
      return { text: rulesToText(allRules), source: 'block' };
    }

    return {
      text: smartTruncate(found.content, DEFAULT_FIRST_LINES),
      source: 'first-lines',
    };
  } catch (_err) {
    return { text: null, source: null };
  }
}

module.exports = { selectContent, estimateTokens, CHARS_PER_TOKEN };
