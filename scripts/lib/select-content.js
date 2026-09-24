'use strict';

const { findRulesFile, parseBlocksFromContent } = require('./parse-rules');

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

/**
 * Renders the first N lines of a file's content plus a note that it was
 * truncated, used by "auto" mode's fallback when a file has no critical
 * block and is too large to inject whole.
 */
function firstLinesWithNote(content, maxLines) {
  const lines = content.split(/\r\n|\r|\n/);
  const head = lines.slice(0, maxLines).join('\n');
  const truncated = lines.length > maxLines;
  if (!truncated) return head;
  return `${head}\n\n[... truncated: full file has ${lines.length} lines, showing first ${maxLines} ...]`;
}

const DEFAULT_FIRST_LINES = 40;

/**
 * Selects what to re-inject for a given cwd and mode. Returns
 * { text, source } where source describes what was used ('block',
 * 'full', 'first-lines', or null), or { text: null, source: null } if
 * nothing should be injected. Never throws.
 *
 * Modes:
 * - 'block': only the marked <!-- rule-guard:critical --> block (legacy
 *   behavior). Nothing if no block exists.
 * - 'full': the entire rules file content. Nothing if no file exists.
 * - 'auto': full file if under maxInjectTokens; otherwise the critical
 *   block if one exists; otherwise the first DEFAULT_FIRST_LINES lines
 *   plus a truncation note. Nothing if no file exists at all.
 */
function selectContent(cwd, mode, maxInjectTokens) {
  try {
    const found = findRulesFile(cwd);
    if (!found) return { text: null, source: null };

    if (mode === 'block') {
      const rules = parseBlocksFromContent(found.content);
      if (rules.length === 0) return { text: null, source: null };
      return { text: rulesToText(rules), source: 'block' };
    }

    if (mode === 'full') {
      return { text: found.content.trim(), source: 'full' };
    }

    // auto (default)
    const budget = typeof maxInjectTokens === 'number' && maxInjectTokens > 0 ? maxInjectTokens : 1500;
    if (estimateTokens(found.content) <= budget) {
      return { text: found.content.trim(), source: 'full' };
    }
    const rules = parseBlocksFromContent(found.content);
    if (rules.length > 0) {
      return { text: rulesToText(rules), source: 'block' };
    }
    return {
      text: firstLinesWithNote(found.content, DEFAULT_FIRST_LINES),
      source: 'first-lines',
    };
  } catch (_err) {
    return { text: null, source: null };
  }
}

module.exports = { selectContent, estimateTokens, CHARS_PER_TOKEN };
