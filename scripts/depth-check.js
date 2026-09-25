#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./lib/load-config');
const { selectContent } = require('./lib/select-content');
const { estimateTranscriptTokens } = require('./lib/estimate-transcript-tokens');
const { shouldFire } = require('./lib/depth-decision');
const { readState, recordFire, recordTurnWithoutFiring } = require('./lib/depth-state');

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

// Plain project information, matching session-start.js's phrasing: not
// framed as an out-of-band system command, so Claude Code's
// prompt-injection defenses don't flag it and surface it to the user as
// a warning instead of using it as context.
function formatContext(text) {
  return ['Project rules from CLAUDE.md/AGENTS.md:', '', text].join('\n');
}

/**
 * Pure decision function for tests: given the hook input fields, returns
 * the additionalContext string to emit, or null if nothing should fire
 * this turn. Also returns whether state should record a fire, so the
 * caller can update the temp-dir state file accordingly. Never throws.
 */
function decide(sessionId, transcriptPath, cwd) {
  try {
    const config = loadConfig(cwd);
    const estimatedTokens = estimateTranscriptTokens(transcriptPath);
    const state = readState(sessionId);

    if (!shouldFire(estimatedTokens, state, config)) {
      return { context: null, fired: false, estimatedTokens };
    }

    const { text } = selectContent(cwd, config.mode, config.maxInjectTokens);
    if (!text) {
      // Nothing to inject (no rules file at all) — don't record a fire,
      // so a project that adds a CLAUDE.md mid-session can still fire
      // once it crosses the threshold from an actual state, not a
      // permanently-consumed one.
      return { context: null, fired: false, estimatedTokens };
    }

    return { context: formatContext(text), fired: true, estimatedTokens };
  } catch (_err) {
    try {
      process.stderr.write(`rule-guard depth-check: internal error, emitting nothing: ${_err && _err.message}\n`);
    } catch (_ignored) {
      // swallow
    }
    return { context: null, fired: false, estimatedTokens: 0 };
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

  const sessionId = input && input.session_id;
  const transcriptPath = input && input.transcript_path;
  const cwd = (input && input.cwd) || process.cwd();

  if (!sessionId || !transcriptPath) return noOutput();

  const { context, fired, estimatedTokens } = decide(sessionId, transcriptPath, cwd);

  if (!fired) {
    recordTurnWithoutFiring(sessionId);
    return noOutput();
  }

  recordFire(sessionId, estimatedTokens);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

if (require.main === module) {
  // main() is async; an uncaught rejection here (e.g. process.stdout.write
  // throwing on EPIPE if the parent closes the pipe early) would otherwise
  // crash the process with a non-zero exit and a stack trace on stderr —
  // the opposite of the fail-open contract every other path in this file
  // guarantees. Swallow and always exit 0 instead.
  main().catch(() => {
    try {
      process.exit(0);
    } catch (_err) {
      // even process.exit can theoretically throw in a torn-down process;
      // nothing more to do
    }
  });
}

module.exports = { decide };
