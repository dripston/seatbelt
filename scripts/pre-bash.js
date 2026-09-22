#!/usr/bin/env node
'use strict';

const { findAndParseRules, guardPatternToRegExp } = require('./lib/parse-rules');
const { splitCommand } = require('./lib/split-command');
const { getRiskyCommands } = require('./risky-commands');

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
  // Silent allow: print nothing, exit 0. Zero overhead, no noise.
  process.exit(0);
}

function emitDecision(decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

/**
 * Pure decision function, exported for tests so we don't have to spawn
 * a process to exercise the logic. Never throws.
 */
function decide(command, cwd) {
  try {
    const { rules } = findAndParseRules(cwd);
    const segments = splitCommand(command);
    const segmentsToCheck = segments.length > 0 ? segments : [command];

    const guardedRules = rules.filter((r) => r.guard);
    const risky = getRiskyCommands(cwd);

    for (const segment of segmentsToCheck) {
      for (const rule of guardedRules) {
        let re;
        try {
          re = guardPatternToRegExp(rule.guard);
        } catch (_err) {
          continue; // bad pattern in user's own file: skip it, don't crash
        }
        if (re.test(segment)) {
          return {
            decision: 'deny',
            reason: `Blocked by project rule: "${rule.text}"`,
          };
        }
      }
    }

    for (const segment of segmentsToCheck) {
      for (const entry of risky) {
        if (entry.re.test(segment)) {
          const ruleList =
            rules.length > 0
              ? rules.map((r) => `- ${r.text}`).join('\n')
              : '(no critical rules defined in CLAUDE.md/AGENTS.md for this project)';
          return {
            decision: 'ask',
            reason: `This command matches a risky pattern (${entry.label}). Project critical rules:\n${ruleList}`,
          };
        }
      }
    }

    return { decision: 'allow', reason: null };
  } catch (_err) {
    // Fail open: any unexpected error must never block the user's session.
    try {
      process.stderr.write(`rule-guard pre-bash: internal error, failing open: ${_err && _err.message}\n`);
    } catch (_ignored) {
      // even stderr can theoretically fail; swallow, still fail open
    }
    return { decision: 'allow', reason: null };
  }
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_err) {
    // Can't parse hook input at all: fail open.
    return allow();
  }

  if (!input || input.tool_name !== 'Bash') {
    return allow();
  }

  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || command.length === 0) {
    return allow();
  }

  const cwd = input.cwd || process.cwd();
  const result = decide(command, cwd);

  if (result.decision === 'allow') {
    return allow();
  }
  return emitDecision(result.decision, result.reason);
}

if (require.main === module) {
  main();
}

module.exports = { decide };
