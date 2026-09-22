#!/usr/bin/env node
'use strict';

const { findAndParseRules } = require('./lib/parse-rules');

// Per DESIGN.md: only re-inject on compact/resume, not plain "startup"
// (rules are already fresh at cold start, so injecting there would just
// be noise) and not "clear"/"fork" (out of scope for v1).
const TRIGGER_SOURCES = new Set(['compact', 'resume']);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function noOutput() {
  process.exit(0);
}

function emitContext(rules) {
  const ruleLines = rules.map((r) => `- ${r.text}`).join('\n');
  const additionalContext = [
    'Critical project rules (re-injected by rule-guard after compaction/resume).',
    'These override anything in the summary above.',
    '',
    ruleLines,
  ].join('\n');

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
    },
    additionalContext,
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

/**
 * Pure function for tests: given a source string and cwd, returns the
 * additionalContext string to emit, or null if nothing should be emitted.
 * Never throws.
 */
function buildContext(source, cwd) {
  try {
    if (!TRIGGER_SOURCES.has(source)) return null;
    const { rules } = findAndParseRules(cwd);
    if (rules.length === 0) return null;
    const ruleLines = rules.map((r) => `- ${r.text}`).join('\n');
    return [
      'Critical project rules (re-injected by rule-guard after compaction/resume).',
      'These override anything in the summary above.',
      '',
      ruleLines,
    ].join('\n');
  } catch (_err) {
    try {
      process.stderr.write(`rule-guard session-start: internal error, emitting nothing: ${_err && _err.message}\n`);
    } catch (_ignored) {
      // swallow
    }
    return null;
  }
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_err) {
    return noOutput();
  }

  const source = input && input.source;
  const cwd = (input && input.cwd) || process.cwd();

  const context = buildContext(source, cwd);
  if (!context) return noOutput();

  const { rules } = findAndParseRules(cwd);
  emitContext(rules);
}

if (require.main === module) {
  main();
}

module.exports = { buildContext, TRIGGER_SOURCES };
