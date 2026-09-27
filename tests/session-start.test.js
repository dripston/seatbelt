'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { buildContext } = require('../scripts/session-start');
const { statePath, writeState } = require('../scripts/lib/depth-state');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'session-start.js');

function freshSessionId() {
  return `test-session-start-${crypto.randomBytes(8).toString('hex')}`;
}

function mkProjectWithCritical(blockBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-session-'));
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `<!-- rule-guard:critical -->\n${blockBody}\n<!-- /rule-guard:critical -->\n`
  );
  return dir;
}

function mkEmptyProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-session-empty-'));
}

test('source=compact with critical rules: emits context', () => {
  const dir = mkProjectWithCritical('- Never git push without asking. [guard: git push]');
  const context = buildContext('compact', dir);
  assert.ok(context);
  assert.match(context, /Project rules from CLAUDE\.md/);
  assert.match(context, /Never git push without asking/);
});

test('source=resume with critical rules: emits context', () => {
  const dir = mkProjectWithCritical('- Always run tests before committing.');
  const context = buildContext('resume', dir);
  assert.ok(context);
  assert.match(context, /Always run tests before committing/);
});

test('source=startup: no injection (rules already fresh at cold start)', () => {
  const dir = mkProjectWithCritical('- Some rule.');
  const context = buildContext('startup', dir);
  assert.equal(context, null);
});

test('source=clear: no injection (out of scope for v1)', () => {
  const dir = mkProjectWithCritical('- Some rule.');
  const context = buildContext('clear', dir);
  assert.equal(context, null);
});

test('no rules file at all: emits nothing even on compact', () => {
  const dir = mkEmptyProject();
  const context = buildContext('compact', dir);
  assert.equal(context, null);
});

test('malformed CLAUDE.md does not crash; auto mode injects the file whole since it fits the token budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-session-malformed-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- rule-guard:critical -->\nno closing tag');
  assert.doesNotThrow(() => {
    const context = buildContext('compact', dir);
    assert.match(context, /no closing tag/);
  });
});

// Real, end-to-end schema check: spawns the actual script and validates
// the emitted JSON shape against Claude Code's real hook contract, not
// just buildContext()'s return string. This is the test that would have
// caught a real, shipped bug found via a live headless debug trace:
// additionalContext was emitted at the TOP LEVEL of the output object
// instead of nested under hookSpecificOutput.additionalContext, which
// Claude Code silently ignores ("Hook JSON output had unrecognized
// keys (ignored): additionalContext") — the injection was a no-op in
// production despite every unit test passing, because no test ever
// checked the actual stdout JSON shape.
test('end-to-end: emitted JSON nests additionalContext under hookSpecificOutput (the real Claude Code hook contract)', () => {
  const dir = mkProjectWithCritical('- Never git push without asking.');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ source: 'resume', cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /Never git push without asking/);
  assert.match(output.systemMessage, /seatbelt/);
  // The bug this guards against: additionalContext at the top level
  // instead of nested. Assert it is NOT there.
  assert.equal(output.additionalContext, undefined);
});

// A compaction's own summary is a large synthetic message written into
// the transcript file depth-check.js measures by byte size, so the depth
// trigger's estimate stays inflated by that single summary right after a
// compact just relieved the model's real context load. Confirmed live:
// a two-message test session still measured ~118K estimated tokens
// purely from a ~190KB compaction summary, firing an extra depth-trigger
// re-injection on the very next prompt. session-start.js resets the
// session's depth-state on source=compact so that stale estimate can't
// cause a misleading double-fire.
test('source=compact clears any existing depth-state for that session', () => {
  const dir = mkProjectWithCritical('- Never git push without asking.');
  const sessionId = freshSessionId();
  writeState(sessionId, { lastFiredTokens: 118521, turnsSinceLastFire: 1 });
  assert.ok(fs.existsSync(statePath(sessionId)), 'precondition: state file exists before compact');

  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ source: 'compact', cwd: dir, session_id: sessionId }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.ok(!fs.existsSync(statePath(sessionId)), 'depth-state file should be cleared after a compact');
});

test('source=resume does NOT clear depth-state (only compact\'s inflated summary needs this reset)', () => {
  const dir = mkProjectWithCritical('- Never git push without asking.');
  const sessionId = freshSessionId();
  writeState(sessionId, { lastFiredTokens: 118521, turnsSinceLastFire: 1 });

  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ source: 'resume', cwd: dir, session_id: sessionId }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.ok(fs.existsSync(statePath(sessionId)), 'resume should leave existing depth-state alone');
});

test('end-to-end: source=startup emits no stdout at all', () => {
  const dir = mkProjectWithCritical('- Some rule.');
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ source: 'startup', cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
