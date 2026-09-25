#!/usr/bin/env node
'use strict';

const { findGuardedRules, guardPatternToRegExp } = require('./lib/parse-rules');

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

function allow() {
  // Silent allow: print nothing, exit 0. Zero overhead, no noise — this
  // is the outcome for every tool call that isn't Bash, and every Bash
  // command that doesn't match a guard pattern the user explicitly wrote.
  process.exit(0);
}

/**
 * Pure decision function for tests: given a command string and cwd,
 * returns the first guarded rule it matches, or null if none match.
 * Deliberately just a literal/wildcard string match against patterns the
 * user wrote themselves in a [guard: pattern] tag — not a classifier, so
 * there's no recall/precision question the way there was for the removed
 * danger-detection feature (which guessed at what's "risky" from
 * arbitrary, unguarded commands). No command splitting/tokenizing either:
 * a cleverly hidden command (piped, chained, eval'd) may not match, and
 * that's an acceptable miss for a reminder — the cost of a false negative
 * here is "no nudge," not a security failure. Never throws.
 */
function decide(command, cwd) {
  try {
    if (typeof command !== 'string' || command.length === 0) return null;
    const guardedRules = findGuardedRules(cwd);
    for (const rule of guardedRules) {
      let re;
      try {
        re = guardPatternToRegExp(rule.guard);
      } catch (_err) {
        continue; // bad pattern in the user's own file: skip it, don't crash
      }
      if (re.test(command)) return rule;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_err) {
    return allow();
  }

  if (!input || input.tool_name !== 'Bash') return allow();

  const command = input.tool_input && input.tool_input.command;
  const cwd = input.cwd || process.cwd();

  const matched = decide(command, cwd);
  if (!matched) return allow();

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Heads up — this command matches your rule: "${matched.text}"`,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { decide };
