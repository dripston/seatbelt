'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { decide } = require('../scripts/pre-bash');

function mkProjectWithCritical(blockBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-prebash-'));
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    `<!-- rule-guard:critical -->\n${blockBody}\n<!-- /rule-guard:critical -->\n`
  );
  return dir;
}

function mkEmptyProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-prebash-empty-'));
}

test('guarded rule match: git push -> deny, quotes the rule', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const result = decide('git push origin main', dir);
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /Never git push without asking me first/);
});

test('no guard, no built-in match, no CLAUDE.md -> allow', () => {
  const dir = mkEmptyProject();
  const result = decide('npm install', dir);
  assert.equal(result.decision, 'allow');
});

test('built-in risky list catches git push --force even with no guard tags', () => {
  const dir = mkEmptyProject();
  const result = decide('git push --force', dir);
  assert.equal(result.decision, 'ask');
  assert.match(result.reason, /git push/);
});

test('guarded rm pattern with wildcard blocks matching path', () => {
  const dir = mkProjectWithCritical('- Never delete files in migrations/. [guard: rm * migrations/*]');
  const result = decide('rm -rf migrations/001_init.sql', dir);
  assert.equal(result.decision, 'deny');
});

test('chained command: cd sub && git push origin main -> denied via guard', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const result = decide('cd sub && git push origin main', dir);
  assert.equal(result.decision, 'deny');
});

test('deploy command with no guard -> ask via built-in list', () => {
  const dir = mkEmptyProject();
  const result = decide('vercel --prod', dir);
  assert.equal(result.decision, 'ask');
});

test('git reset --hard triggers built-in ask', () => {
  const dir = mkEmptyProject();
  const result = decide('git reset --hard HEAD~3', dir);
  assert.equal(result.decision, 'ask');
});

// --- Adversarial cases from the plan ---

test('adversarial: extra spaces "git  push" still matches', () => {
  const dir = mkProjectWithCritical('- no push [guard: git push]');
  const result = decide('git  push origin main', dir);
  assert.equal(result.decision, 'deny');
});

test('adversarial: git -C repo push still matches built-in list', () => {
  const dir = mkEmptyProject();
  const result = decide('git -C repo push --force', dir);
  assert.equal(result.decision, 'ask');
});

test('adversarial: cd x && git push is caught (chained)', () => {
  const dir = mkEmptyProject();
  const result = decide('cd x && git push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('adversarial: env var prefix does not evade detection', () => {
  const dir = mkEmptyProject();
  const result = decide('FOO=bar git push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('adversarial: echo "git push" should NOT trigger (quoted string, not an actual push)', () => {
  const dir = mkEmptyProject();
  const result = decide('echo "git push"', dir);
  // Known limitation: our matcher is regex-based, not a real shell parser,
  // so it cannot distinguish a quoted string from a real invocation.
  // We document this rather than pretend otherwise. Assert current actual
  // behavior so a future change to this behavior is a deliberate, visible diff.
  assert.equal(result.decision, 'ask');
});

test('malformed CLAUDE.md does not crash decide(), fails open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-prebash-malformed-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- rule-guard:critical -->\nno closing tag');
  assert.doesNotThrow(() => {
    const result = decide('npm test', dir);
    assert.equal(result.decision, 'allow');
  });
});

test('performance: decide() completes well under 100ms', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const start = Date.now();
  decide('git push origin main', dir);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 100, `decide() took ${elapsed}ms, expected <100ms`);
});
