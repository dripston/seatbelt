'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseBlocksFromContent,
  findAndParseRules,
  guardPatternToRegExp,
} = require('../scripts/lib/parse-rules');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-test-'));
}

test('no file: findAndParseRules returns empty, does not throw', () => {
  const dir = mkTmpDir();
  const result = findAndParseRules(dir);
  assert.deepEqual(result.rules, []);
  assert.deepEqual(result.sources, []);
});

test('no critical block: file exists but has no rule-guard block', () => {
  const content = '# My Project\n\nSome normal instructions here.\n';
  const rules = parseBlocksFromContent(content);
  assert.deepEqual(rules, []);
});

test('single block with guarded and unguarded rules', () => {
  const content = [
    '<!-- rule-guard:critical -->',
    '- Never git push without asking me first. [guard: git push]',
    '- Never delete files in migrations/. [guard: rm * migrations/*]',
    '- Always run tests before committing.',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 3);
  assert.equal(rules[0].text, 'Never git push without asking me first.');
  assert.equal(rules[0].guard, 'git push');
  assert.equal(rules[1].guard, 'rm * migrations/*');
  assert.equal(rules[2].guard, null);
  assert.equal(rules[2].text, 'Always run tests before committing.');
});

test('multiple files: findAndParseRules merges CLAUDE.md and AGENTS.md', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Rule from CLAUDE.md [guard: foo]\n<!-- /rule-guard:critical -->\n'
  );
  fs.writeFileSync(
    path.join(dir, 'AGENTS.md'),
    '<!-- rule-guard:critical -->\n- Rule from AGENTS.md [guard: bar]\n<!-- /rule-guard:critical -->\n'
  );
  const result = findAndParseRules(dir);
  assert.equal(result.rules.length, 2);
  assert.equal(result.sources.length, 2);
  const texts = result.rules.map((r) => r.text).sort();
  assert.deepEqual(texts, ['Rule from AGENTS.md', 'Rule from CLAUDE.md']);
});

test('.claude/CLAUDE.md is also discovered', () => {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(
    path.join(dir, '.claude', 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Nested rule [guard: baz]\n<!-- /rule-guard:critical -->\n'
  );
  const result = findAndParseRules(dir);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].text, 'Nested rule');
});

test('malformed block: unclosed tag yields no rules, does not throw', () => {
  const content = '<!-- rule-guard:critical -->\n- Some rule\n(no closing tag)';
  assert.doesNotThrow(() => {
    const rules = parseBlocksFromContent(content);
    assert.deepEqual(rules, []);
  });
});

test('malformed block: closing tag with no opening tag yields no rules', () => {
  const content = '- Some rule\n<!-- /rule-guard:critical -->\n';
  const rules = parseBlocksFromContent(content);
  assert.deepEqual(rules, []);
});

test('unicode content in rules is preserved', () => {
  const content = [
    '<!-- rule-guard:critical -->',
    '- Nunca hagas git push sin preguntar 日本語のテスト. [guard: git push]',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 1);
  assert.match(rules[0].text, /日本語のテスト/);
});

test('Windows line endings (CRLF) are handled', () => {
  const content =
    '<!-- rule-guard:critical -->\r\n- Rule one [guard: a]\r\n- Rule two [guard: b]\r\n<!-- /rule-guard:critical -->\r\n';
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].text, 'Rule one');
  assert.equal(rules[1].text, 'Rule two');
});

test('huge file does not throw and completes', () => {
  const filler = '# padding line\n'.repeat(200000); // ~2.8MB of filler
  const content =
    filler +
    '<!-- rule-guard:critical -->\n- Needle rule [guard: needle]\n<!-- /rule-guard:critical -->\n' +
    filler;
  const start = Date.now();
  const rules = parseBlocksFromContent(content);
  const elapsed = Date.now() - start;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].text, 'Needle rule');
  assert.ok(elapsed < 2000, `parsing huge file took ${elapsed}ms, expected <2000ms`);
});

test('guardPatternToRegExp: wildcard matches variable content', () => {
  const re = guardPatternToRegExp('rm * migrations/*');
  assert.ok(re.test('rm -rf migrations/001_init.sql'));
  assert.ok(!re.test('rm -rf src/index.js'));
});

test('guardPatternToRegExp: literal pattern with no wildcard', () => {
  const re = guardPatternToRegExp('git push');
  assert.ok(re.test('git push origin main'));
  assert.ok(re.test('GIT PUSH')); // case-insensitive
  assert.ok(!re.test('git pull'));
});

test('guardPatternToRegExp: special regex characters in pattern are escaped', () => {
  const re = guardPatternToRegExp('rm -rf .git/*');
  assert.ok(re.test('rm -rf .git/hooks'));
  assert.ok(!re.test('rm -rf Xgit/hooks')); // literal dot should not match any-char
});

test('unreadable/permission-error file does not crash findAndParseRules', () => {
  const dir = mkTmpDir();
  // Point at a directory instead of a file for CLAUDE.md path to force a read error.
  fs.mkdirSync(path.join(dir, 'CLAUDE.md'));
  assert.doesNotThrow(() => {
    const result = findAndParseRules(dir);
    assert.deepEqual(result.rules, []);
  });
});

test('numbered list items (1. 2.) in critical block are parsed', () => {
  const content = [
    '<!-- rule-guard:critical -->',
    '1. Never git push without asking me first.',
    '2. Always run tests before committing.',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].text, 'Never git push without asking me first.');
  assert.equal(rules[1].text, 'Always run tests before committing.');
});

test('+ bullet items in critical block are parsed', () => {
  const content = [
    '<!-- rule-guard:critical -->',
    '+ Never delete the database.',
    '+ Always ask before deploying.',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].text, 'Never delete the database.');
  assert.equal(rules[1].text, 'Always ask before deploying.');
});

test('mixed bullet styles in critical block all parse correctly', () => {
  const content = [
    '<!-- rule-guard:critical -->',
    '- Dash rule',
    '* Star rule',
    '+ Plus rule',
    '1. Numbered rule',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const rules = parseBlocksFromContent(content);
  assert.equal(rules.length, 4);
  const texts = rules.map((r) => r.text);
  assert.deepEqual(texts, ['Dash rule', 'Star rule', 'Plus rule', 'Numbered rule']);
});
