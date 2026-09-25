#!/usr/bin/env node
'use strict';

const { selectContent } = require('./lib/select-content');
const { loadConfig } = require('./lib/load-config');

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

// Plain project information, not a directive envelope: Claude Code's
// prompt-injection defenses can flag hook text framed as an out-of-band
// system command ("SYSTEM:", "you must", "IMPORTANT INSTRUCTION"), which
// surfaces the text to the user as a warning instead of using it as
// context. This phrasing was tested live and does not trigger that
// warning.
function formatContext(text) {
  return ['Project rules from CLAUDE.md/AGENTS.md:', '', text].join('\n');
}

/**
 * Pure function for tests: given a source string and cwd, returns the
 * additionalContext string to emit, or null if nothing should be emitted.
 * Never throws.
 */
function buildContext(source, cwd) {
  try {
    if (!TRIGGER_SOURCES.has(source)) return null;
    const config = loadConfig(cwd);
    const { text } = selectContent(cwd, config.mode, config.maxInjectTokens);
    if (!text) return null;
    return formatContext(text);
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

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { buildContext, TRIGGER_SOURCES };
