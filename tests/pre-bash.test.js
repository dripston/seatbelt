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
  // Fixed in the fix-pass (Phase 2, tokenize-command.js): echo is a
  // read-only head command, so text inside its arguments is no longer
  // exposed to risky-pattern matching. This was a real, confirmed
  // false-positive bug in the original build (see evals/results/VERDICT.md)
  // — the test now asserts the corrected, intended behavior.
  assert.equal(result.decision, 'allow');
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

// --- Fix-pass Phase 2: newline-sensitivity and whitespace-normalization fixes ---

test('newline: backslash line-continuation between git and push is still caught (built-in list)', () => {
  const dir = mkEmptyProject();
  const result = decide('git\\\n  push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('newline: backslash line-continuation is still caught by a guarded rule', () => {
  const dir = mkProjectWithCritical('- Never push. [guard: git push]');
  const result = decide('git\\\n  push origin main', dir);
  assert.equal(result.decision, 'deny');
});

test('whitespace: non-breaking space (U+00A0) between git and push is normalized and still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('git push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('whitespace: figure space (U+2007) is normalized and still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('git push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('whitespace: narrow no-break space (U+202F) is normalized and still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('git push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('whitespace: ideographic space (U+3000) is normalized and still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('git　push origin main', dir);
  assert.equal(result.decision, 'ask');
});

test('whitespace: guarded rule pattern still matches through a non-breaking space in the command', () => {
  const dir = mkProjectWithCritical('- Never push. [guard: git push]');
  const result = decide('git push origin main', dir);
  assert.equal(result.decision, 'deny');
});

// --- Fix-pass Phase 2: near-miss precision fixes (tokenizer integration) ---

test('near-miss: echo with reminder text quoting a rule is NOT denied', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const result = decide('echo "reminder: never git push without asking"', dir);
  assert.equal(result.decision, 'allow');
});

test('near-miss: grep for DROP TABLE is NOT denied even with a matching guard rule', () => {
  const dir = mkProjectWithCritical('- Never drop a database table. [guard: DROP TABLE]');
  const result = decide('grep "DROP TABLE" schema.sql', dir);
  assert.equal(result.decision, 'allow');
});

test('near-miss: git log --grep does not trigger on the searched text', () => {
  const dir = mkEmptyProject();
  const result = decide('git log --grep="push"', dir);
  assert.equal(result.decision, 'allow');
});

test('near-miss: a shell comment mentioning a risky command is inert', () => {
  const dir = mkEmptyProject();
  const result = decide('# git push later once tests pass', dir);
  assert.equal(result.decision, 'allow');
});

test('near-miss: writing risky text to a file via redirection is inert', () => {
  const dir = mkEmptyProject();
  const result = decide('echo "git push" >> notes.md', dir);
  assert.equal(result.decision, 'allow');
});

test('but: eval of a real push string is still caught (evaluator, not inert)', () => {
  const dir = mkEmptyProject();
  const result = decide('eval "git push origin main"', dir);
  assert.equal(result.decision, 'ask');
});

test('but: a real git push chained after a benign echo is still caught', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const result = decide('echo start && git push origin main', dir);
  assert.equal(result.decision, 'deny');
});

// --- Phase 5 regression: piping a quoted risky string into a shell must
// still be caught. Found because pre-bash.js's own &&/;/| segment split
// was running BEFORE classifySegment could see the "a | bash" relationship
// intact, silently defeating the evaluator-detection logic from Phase 2.
// Fixed by switching to splitCommandKeepPipes ahead of classifySegment.

test('regression: echo of a risky string piped into bash is still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('echo "git push origin main" | bash', dir);
  assert.equal(result.decision, 'ask');
});

test('regression: printf of a risky string piped into sh is still caught', () => {
  const dir = mkEmptyProject();
  const result = decide('printf "git push origin main" | sh', dir);
  assert.equal(result.decision, 'ask');
});

test('regression: piping a risky string into bash still matches a guarded rule', () => {
  const dir = mkProjectWithCritical('- Never git push without asking me first. [guard: git push]');
  const result = decide('echo "git push origin main" | bash', dir);
  assert.equal(result.decision, 'deny');
});

test('but: piping a genuinely inert string into cat (not a shell) stays allowed', () => {
  const dir = mkEmptyProject();
  const result = decide('echo "git push origin main" | cat', dir);
  assert.equal(result.decision, 'allow');
});
