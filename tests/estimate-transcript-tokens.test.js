'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { estimateTranscriptTokens } = require('../scripts/lib/estimate-transcript-tokens');

function mkTranscript(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-transcript-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, content);
  return file;
}

test('missing file: returns 0, does not throw', () => {
  assert.doesNotThrow(() => {
    const tokens = estimateTranscriptTokens('/nonexistent/path/transcript.jsonl');
    assert.equal(tokens, 0);
  });
});

test('undefined/null/empty path: returns 0', () => {
  assert.equal(estimateTranscriptTokens(undefined), 0);
  assert.equal(estimateTranscriptTokens(null), 0);
  assert.equal(estimateTranscriptTokens(''), 0);
});

test('small file: exact character count divided by 4', () => {
  const file = mkTranscript('a'.repeat(4000));
  assert.equal(estimateTranscriptTokens(file), 1000);
});

test('large file (over the exact-read threshold): estimated from byte size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-transcript-large-'));
  const file = path.join(dir, 'transcript.jsonl');
  // Write just over the 2MB exact-read cutoff.
  const chunk = 'x'.repeat(1024 * 1024);
  fs.writeFileSync(file, chunk + chunk + chunk);
  const tokens = estimateTranscriptTokens(file);
  assert.ok(tokens > 700000, `expected roughly 3MB/4 tokens, got ${tokens}`);
});

test('empty file: returns 0', () => {
  const file = mkTranscript('');
  assert.equal(estimateTranscriptTokens(file), 0);
});
