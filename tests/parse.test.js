'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseBlocksFromContent,
  findAllRulesFiles,
  findGuardedRules,
  guardPatternToRegExp,
  collectSearchDirs,
  MAX_UPWARD_LEVELS,
} = require('../scripts/lib/parse-rules');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-test-'));
}

// Mirrors the merge pattern production code actually uses
// (scripts/lib/select-content.js): findAllRulesFiles for raw file
// discovery, then parseBlocksFromContent per file to extract rules.
function findAndParseRules(cwd) {
  const files = findAllRulesFiles(cwd);
  const rules = files.flatMap((f) => parseBlocksFromContent(f.content));
  return { rules, sources: files.map((f) => f.path) };
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

// --- Upward directory traversal (monorepo support) ---
//
// Real bug, reproduced directly before this fix existed: a session
// started in a monorepo subdirectory (e.g. `packages/api`) found ZERO
// rules even when a valid CLAUDE.md existed at the repo root, because
// findAndParseRules/findRulesFile/findAllRulesFiles only ever checked
// `cwd` itself. Confirmed reachable in practice via live-captured hook
// input (Claude Code's `cwd` does track a Bash `cd` into a subdirectory).

test('findAndParseRules discovers a repo-root CLAUDE.md from a subdirectory', () => {
  const root = mkTmpDir();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Root rule [guard: foo]\n<!-- /rule-guard:critical -->\n'
  );
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });

  const atRoot = findAndParseRules(root);
  const atSub = findAndParseRules(sub);
  assert.equal(atRoot.rules.length, 1);
  assert.equal(atSub.rules.length, 1, 'subdirectory search should find the root rules file');
  assert.equal(atSub.rules[0].text, 'Root rule');
});

test('findAndParseRules discovers rules several levels up (nested monorepo)', () => {
  const root = mkTmpDir();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Deeply inherited rule\n<!-- /rule-guard:critical -->\n'
  );
  const deep = path.join(root, 'apps', 'web', 'src', 'components', 'forms');
  fs.mkdirSync(deep, { recursive: true });

  const result = findAndParseRules(deep);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].text, 'Deeply inherited rule');
});

test('upward traversal stops at a .git boundary and does not read past the repo root', () => {
  const outside = mkTmpDir();
  fs.writeFileSync(
    path.join(outside, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Rule outside the repo, must not be found\n<!-- /rule-guard:critical -->\n'
  );
  const repoRoot = path.join(outside, 'myrepo');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Rule inside the repo\n<!-- /rule-guard:critical -->\n'
  );
  const sub = path.join(repoRoot, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });

  const result = findAndParseRules(sub);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].text, 'Rule inside the repo');
});

test('merges rules from both a subdirectory-nearest file and a repo-root file if both exist', () => {
  const root = mkTmpDir();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Root-level rule\n<!-- /rule-guard:critical -->\n'
  );
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(
    path.join(sub, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Package-level rule\n<!-- /rule-guard:critical -->\n'
  );

  const result = findAndParseRules(sub);
  const texts = result.rules.map((r) => r.text).sort();
  assert.deepEqual(texts, ['Package-level rule', 'Root-level rule']);
});

test('collectSearchDirs never walks past MAX_UPWARD_LEVELS even with no .git anywhere', () => {
  // Build a directory chain deeper than MAX_UPWARD_LEVELS with no .git
  // at all, to exercise the hard cap rather than the repo-boundary stop.
  const root = mkTmpDir();
  let deepest = root;
  for (let i = 0; i < MAX_UPWARD_LEVELS + 5; i++) {
    deepest = path.join(deepest, `level${i}`);
  }
  fs.mkdirSync(deepest, { recursive: true });

  const dirs = collectSearchDirs(deepest);
  assert.equal(dirs.length, MAX_UPWARD_LEVELS);
});

test('collectSearchDirs on a path at the filesystem root does not throw or loop forever', () => {
  const fsRoot = path.parse(process.cwd()).root; // e.g. "C:\\" or "/"
  assert.doesNotThrow(() => {
    const dirs = collectSearchDirs(fsRoot);
    assert.ok(dirs.length >= 1);
  });
});

test('findRulesFile also benefits from upward traversal', () => {
  const { findRulesFile } = require('../scripts/lib/parse-rules');
  const root = mkTmpDir();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Plain content, no block, from repo root.\n');
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });

  const found = findRulesFile(sub);
  assert.ok(found);
  assert.match(found.content, /Plain content, no block, from repo root/);
});

test('a .git worktree (file, not directory) is still recognized as a repo boundary', () => {
  const outside = mkTmpDir();
  fs.writeFileSync(
    path.join(outside, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Should not be found, outside the worktree boundary\n<!-- /rule-guard:critical -->\n'
  );
  const worktreeRoot = path.join(outside, 'myworktree');
  fs.mkdirSync(worktreeRoot, { recursive: true });
  // A real git worktree's .git is a FILE containing a "gitdir:" pointer,
  // not a directory - fs.existsSync doesn't care about the distinction,
  // but this locks in that the code doesn't accidentally assume a
  // directory (e.g. via fs.statSync(...).isDirectory()).
  fs.writeFileSync(path.join(worktreeRoot, '.git'), 'gitdir: /elsewhere/.git/worktrees/myworktree\n');
  fs.writeFileSync(
    path.join(worktreeRoot, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Worktree rule\n<!-- /rule-guard:critical -->\n'
  );
  const sub = path.join(worktreeRoot, 'src');
  fs.mkdirSync(sub);

  const result = findAndParseRules(sub);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].text, 'Worktree rule');
});

test('findAllRulesFiles collects files from multiple levels, nearest first', () => {
  const { findAllRulesFiles } = require('../scripts/lib/parse-rules');
  const root = mkTmpDir();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'root file');
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'CLAUDE.md'), 'sub file');

  const all = findAllRulesFiles(sub);
  assert.equal(all.length, 2);
  assert.equal(all[0].content, 'sub file', 'nearest file should come first');
  assert.equal(all[1].content, 'root file');
});

// --- guardPatternToRegExp / findGuardedRules (guard-check.js's PreToolUse nudge) ---

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

test('findGuardedRules only returns rules with a [guard: ...] tag', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    [
      '<!-- rule-guard:critical -->',
      '- Guarded rule. [guard: git push]',
      '- Plain rule with no guard tag.',
      '<!-- /rule-guard:critical -->',
    ].join('\n')
  );
  const guarded = findGuardedRules(dir);
  assert.equal(guarded.length, 1);
  assert.equal(guarded[0].text, 'Guarded rule.');
});

test('findGuardedRules merges guarded rules across monorepo levels', () => {
  const root = mkTmpDir();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Root guarded rule. [guard: foo]\n<!-- /rule-guard:critical -->\n'
  );
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(
    path.join(sub, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Sub guarded rule. [guard: bar]\n<!-- /rule-guard:critical -->\n'
  );

  const guarded = findGuardedRules(sub);
  const texts = guarded.map((r) => r.text).sort();
  assert.deepEqual(texts, ['Root guarded rule.', 'Sub guarded rule.']);
});

test('findGuardedRules returns empty array (not throw) when no files exist', () => {
  const dir = mkTmpDir();
  assert.doesNotThrow(() => {
    const guarded = findGuardedRules(dir);
    assert.deepEqual(guarded, []);
  });
});
