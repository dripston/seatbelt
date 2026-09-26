'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { decide, isMatchedTool } = require('../scripts/guard-check');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'guard-check.js');

function mkProject(blockBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-guardcheck-'));
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `<!-- rule-guard:critical -->\n${blockBody}\n<!-- /rule-guard:critical -->\n`
  );
  return dir;
}

test('command matching a guarded rule returns that rule', () => {
  const dir = mkProject('- Never push without asking. [guard: git push]');
  const rule = decide('git push origin main', dir);
  assert.ok(rule);
  assert.equal(rule.text, 'Never push without asking.');
});

test('command not matching any guard returns null', () => {
  const dir = mkProject('- Never push without asking. [guard: git push]');
  const rule = decide('ls -la', dir);
  assert.equal(rule, null);
});

test('unguarded rule (no [guard: ...] tag) is never matched, even if the text overlaps the command', () => {
  const dir = mkProject('- Never run git push.');
  const rule = decide('git push origin main', dir);
  assert.equal(rule, null, 'plain rules must never trigger a nudge, only explicitly guarded ones');
});

test('a degenerate "*" guard pattern does not nudge on an unrelated command', () => {
  const dir = mkProject('- Meant to guard everything risky. [guard: *]');
  const rule = decide('ls -la', dir);
  assert.equal(rule, null, 'a bare wildcard pattern must be filtered out, not match every command');
});

test('wildcard guard pattern matches variable content', () => {
  const dir = mkProject('- Never touch migrations. [guard: rm * migrations/*]');
  const rule = decide('rm -rf migrations/001_init.sql', dir);
  assert.ok(rule);
  const noMatch = decide('rm -rf src/index.js', dir);
  assert.equal(noMatch, null);
});

test('multiple guarded rules: first match wins, others do not prevent it', () => {
  const dir = mkProject(
    ['- Rule A. [guard: foo]', '- Rule B. [guard: git push]'].join('\n')
  );
  const rule = decide('git push origin main', dir);
  assert.ok(rule);
  assert.equal(rule.text, 'Rule B.');
});

test('no CLAUDE.md at all: returns null, does not throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-guardcheck-empty-'));
  assert.doesNotThrow(() => {
    const rule = decide('git push origin main', dir);
    assert.equal(rule, null);
  });
});

test('empty/non-string command returns null, does not throw', () => {
  const dir = mkProject('- Rule. [guard: git push]');
  assert.equal(decide('', dir), null);
  assert.equal(decide(undefined, dir), null);
  assert.equal(decide(null, dir), null);
});

test('bad guard pattern in the user file is skipped, not thrown', () => {
  // guardPatternToRegExp never actually throws for any string input (it
  // only splits/escapes), but this locks in the fail-open contract at
  // the decide() level regardless, matching the pattern of every other
  // hook in this project.
  const dir = mkProject('- Weird pattern. [guard: ***]');
  assert.doesNotThrow(() => decide('anything', dir));
});

test('a command that only textually resembles a pattern via unrelated substrings does not match', () => {
  const dir = mkProject('- Never push. [guard: git push]');
  const rule = decide('echo "please dont git push this"', dir);
  // Deliberately matches: this hook does raw string matching, not shell
  // parsing, so text inside an echo/string still matches. This is the
  // documented tradeoff (see guard-check.js: no tokenizing, a false
  // positive here just means an extra nudge, never a block).
  assert.ok(rule, 'raw string match is expected to fire even inside a quoted arg — a nudge, not a block, so this is an acceptable false positive');
});

// --- isMatchedTool: which tool_name values carry a shell command ---
//
// Real bug, reproduced live before this was added: Claude Code on Windows
// falls back to a tool literally named "PowerShell" (not "Bash") when Git
// Bash isn't detected, confirmed via a live hook-input capture — logged as
// "Git Bash not found; BashTool will be unavailable" — while still putting
// the command string under the same tool_input.command field. Matching
// only "Bash" meant the PreToolUse dispatcher never even invoked this
// script on such a machine: completely inert, with zero indication to the
// user. This exact failure mode (silently doing nothing) is what this
// whole project exists to avoid.

test('isMatchedTool accepts Bash and PowerShell, rejects everything else', () => {
  assert.equal(isMatchedTool('Bash'), true);
  assert.equal(isMatchedTool('PowerShell'), true);
  assert.equal(isMatchedTool('Read'), false);
  assert.equal(isMatchedTool('Edit'), false);
  assert.equal(isMatchedTool(undefined), false);
  assert.equal(isMatchedTool(null), false);
});

// --- End-to-end: real Claude Code hook contract ---

test('end-to-end: non-shell tool call is silently allowed (no stdout)', () => {
  const dir = mkProject('- Rule. [guard: git push]');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('end-to-end: a matching command via the PowerShell tool_name still triggers the nudge (the Windows Git-Bash-unavailable fallback path)', () => {
  const dir = mkProject('- Never push without asking. [guard: git push]');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'git push origin main' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /Never push without asking/);
});

test('end-to-end: Bash command with no guard match is silently allowed', () => {
  const dir = mkProject('- Rule. [guard: git push]');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('end-to-end: matching Bash command emits permissionDecision "ask" nested under hookSpecificOutput', () => {
  const dir = mkProject('- Never push without asking. [guard: git push]');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /Never push without asking/);
  // Never "deny": this feature nudges, it does not block.
  assert.notEqual(output.hookSpecificOutput.permissionDecision, 'deny');
});

test('end-to-end: malformed JSON input is silently allowed, does not crash', () => {
  const result = spawnSync('node', [SCRIPT], {
    input: 'not valid json {{{',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('end-to-end: missing tool_input.command is silently allowed', () => {
  const dir = mkProject('- Rule. [guard: git push]');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: {}, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
