'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { normalizeCwd, findAndParseRules } = require('../scripts/lib/parse-rules');

const isWin = os.platform() === 'win32';

test('POSIX-mount-style path (/d/foo) is normalized to D:\\foo on win32', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('/d/foo'), 'D:\\foo');
});

test('POSIX-mount-style path with nested dirs (/d/skill/docs) normalizes correctly', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('/d/skill/docs'), 'D:\\skill\\docs');
});

test('POSIX-mount-style root only (/c) normalizes to C:\\', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('/c'), 'C:\\');
});

test('already-native Windows path (D:\\foo) passes through unchanged', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('D:\\foo'), 'D:\\foo');
});

test('forward-slash Windows path (D:/foo) passes through unchanged (path.join handles it fine)', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('D:/foo'), 'D:/foo');
});

test('UNC path passes through unchanged', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('\\\\server\\share\\dir'), '\\\\server\\share\\dir');
});

test('relative path passes through unchanged', { skip: !isWin }, () => {
  assert.equal(normalizeCwd('relative/dir'), 'relative/dir');
});

test('non-string input passes through unchanged, does not throw', () => {
  assert.equal(normalizeCwd(undefined), undefined);
  assert.equal(normalizeCwd(null), null);
  assert.equal(normalizeCwd(123), 123);
});

test('empty string passes through unchanged', () => {
  assert.equal(normalizeCwd(''), '');
});

// Integration: findAndParseRules should find rules via a POSIX-style cwd
// on win32, proving the fix actually threads through, not just the helper
// in isolation.
test('findAndParseRules discovers rules via POSIX-style cwd on win32', { skip: !isWin }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-posix-'));
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Never push. [guard: git push]\n<!-- /rule-guard:critical -->\n'
  );

  // Convert the real Windows tmp dir into its POSIX-mount-style equivalent
  // the way Git Bash would report it, e.g. C:\Users\x\AppData\... -> /c/Users/x/AppData/...
  const driveMatch = /^([a-zA-Z]):(.*)$/.exec(dir);
  assert.ok(driveMatch, `expected an absolute Windows path from mkdtempSync, got: ${dir}`);
  const posixStyle = `/${driveMatch[1].toLowerCase()}${driveMatch[2].replace(/\\/g, '/')}`;

  const result = findAndParseRules(posixStyle);
  assert.equal(result.rules.length, 1, `expected to find 1 rule via POSIX-style cwd "${posixStyle}", got: ${JSON.stringify(result)}`);
  assert.equal(result.rules[0].text, 'Never push.');
});
