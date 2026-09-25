'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { selectContent, estimateTokens } = require('../scripts/lib/select-content');

function mkProject(fileContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-select-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fileContent);
  return dir;
}

function mkEmptyProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-select-empty-'));
}

const SMALL_WITH_BLOCK = [
  'Some project notes here.',
  '',
  '<!-- rule-guard:critical -->',
  '- Never git push without asking. [guard: git push]',
  '- Always run tests before committing.',
  '<!-- /rule-guard:critical -->',
  '',
  'More notes.',
].join('\n');

// --- mode: block ---

test('block mode: returns only the marked block', () => {
  const dir = mkProject(SMALL_WITH_BLOCK);
  const { text, source } = selectContent(dir, 'block');
  assert.equal(source, 'block');
  assert.match(text, /Never git push without asking/);
  assert.doesNotMatch(text, /Some project notes here/);
});

test('block mode: no block in file returns nothing', () => {
  const dir = mkProject('Just some notes, no critical block at all.');
  const result = selectContent(dir, 'block');
  assert.equal(result.text, null);
  assert.equal(result.source, null);
});

test('block mode: no file at all returns nothing', () => {
  const dir = mkEmptyProject();
  const result = selectContent(dir, 'block');
  assert.equal(result.text, null);
});

// --- mode: full ---

test('full mode: returns entire file content regardless of block', () => {
  const dir = mkProject(SMALL_WITH_BLOCK);
  const { text, source } = selectContent(dir, 'full');
  assert.equal(source, 'full');
  assert.match(text, /Some project notes here/);
  assert.match(text, /Never git push without asking/);
  assert.match(text, /More notes/);
});

test('full mode: file with no block still returns whole file', () => {
  const dir = mkProject('Just plain project notes, no block.');
  const { text, source } = selectContent(dir, 'full');
  assert.equal(source, 'full');
  assert.match(text, /plain project notes/);
});

test('full mode: no file returns nothing', () => {
  const dir = mkEmptyProject();
  const result = selectContent(dir, 'full');
  assert.equal(result.text, null);
});

// --- mode: auto ---

test('auto mode: small file under budget is injected whole', () => {
  const dir = mkProject(SMALL_WITH_BLOCK);
  const { text, source } = selectContent(dir, 'auto', 1500);
  assert.equal(source, 'full');
  assert.match(text, /Some project notes here/);
});

test('auto mode: large file with a block falls back to the block', () => {
  const bigFiller = 'x'.repeat(20000); // ~5000 tokens, over a 1500 budget
  const content = [
    bigFiller,
    '<!-- rule-guard:critical -->',
    '- Always run tests before committing.',
    '<!-- /rule-guard:critical -->',
  ].join('\n');
  const dir = mkProject(content);
  const { text, source } = selectContent(dir, 'auto', 1500);
  assert.equal(source, 'block');
  assert.match(text, /Always run tests before committing/);
  assert.doesNotMatch(text, /x{100}/);
});

test('auto mode: large file with no block falls back to smart-truncated section with most rule density', () => {
  // Build a file where rules are at the bottom, not the top
  const headerLines = [];
  for (let i = 0; i < 200; i++) headerLines.push(`boilerplate paragraph ${i}`);
  const ruleLines = [];
  for (let i = 0; i < 50; i++) ruleLines.push(`- Rule number ${i} never do the thing`);
  const content = [...headerLines, ...ruleLines].join('\n');
  const dir = mkProject(content);
  const { text, source } = selectContent(dir, 'auto', 100); // tiny budget forces fallback
  assert.equal(source, 'first-lines');
  // Smart truncation should have found the dense rule section, not the boilerplate header
  assert.match(text, /Rule number/);
});

test('auto mode: no file at all returns nothing', () => {
  const dir = mkEmptyProject();
  const result = selectContent(dir, 'auto', 1500);
  assert.equal(result.text, null);
  assert.equal(result.source, null);
});

test('auto mode: respects a custom maxInjectTokens budget', () => {
  const content = 'y'.repeat(2000); // ~500 tokens
  const dir = mkProject(content);
  const underBudget = selectContent(dir, 'auto', 1000);
  assert.equal(underBudget.source, 'full');

  const overBudget = selectContent(dir, 'auto', 100);
  // No block and no room for full content -> first-lines fallback.
  assert.equal(overBudget.source, 'first-lines');
});

// --- estimateTokens ---

test('estimateTokens: roughly 4 chars per token', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(4000)), 1000);
});

// --- default mode fallback ---

test('unrecognized mode string falls back to auto behavior', () => {
  const dir = mkProject(SMALL_WITH_BLOCK);
  const { text, source } = selectContent(dir, 'not-a-real-mode', 1500);
  assert.equal(source, 'full');
  assert.match(text, /Some project notes here/);
});
