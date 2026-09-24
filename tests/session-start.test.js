'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildContext } = require('../scripts/session-start');

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
