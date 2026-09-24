'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { decide } = require('../scripts/depth-check');
const { clearState } = require('../scripts/lib/depth-state');

function freshSessionId() {
  return `test-${crypto.randomBytes(8).toString('hex')}`;
}

function mkProjectWithRules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-depthcheck-'));
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '<!-- rule-guard:critical -->\n- Never git push without asking.\n<!-- /rule-guard:critical -->\n'
  );
  return dir;
}

function mkTranscriptOfTokens(approxTokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-depthcheck-transcript-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, 'a'.repeat(approxTokens * 4));
  return file;
}

test('below threshold: no context emitted, fired is false', () => {
  const cwd = mkProjectWithRules();
  const transcript = mkTranscriptOfTokens(50000);
  const sessionId = freshSessionId();
  const result = decide(sessionId, transcript, cwd);
  assert.equal(result.context, null);
  assert.equal(result.fired, false);
  clearState(sessionId);
});

test('above threshold with rules present: emits context and fired is true', () => {
  const cwd = mkProjectWithRules();
  const transcript = mkTranscriptOfTokens(120000);
  const sessionId = freshSessionId();
  const result = decide(sessionId, transcript, cwd);
  assert.match(result.context, /Project rules from CLAUDE\.md/);
  assert.match(result.context, /Never git push without asking/);
  assert.equal(result.fired, true);
  clearState(sessionId);
});

test('above threshold but no rules file at all: does not fire (nothing to inject)', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-depthcheck-norules-'));
  const transcript = mkTranscriptOfTokens(120000);
  const sessionId = freshSessionId();
  const result = decide(sessionId, transcript, cwd);
  assert.equal(result.context, null);
  assert.equal(result.fired, false);
  clearState(sessionId);
});

test('unreadable transcript path: fails open, no crash, no fire', () => {
  const cwd = mkProjectWithRules();
  const sessionId = freshSessionId();
  assert.doesNotThrow(() => {
    const result = decide(sessionId, '/definitely/does/not/exist.jsonl', cwd);
    assert.equal(result.context, null);
    assert.equal(result.fired, false);
  });
  clearState(sessionId);
});

test('respects a project config that lowers firstFire', () => {
  const cwd = mkProjectWithRules();
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'seatbelt.json'), JSON.stringify({ firstFire: 1000 }));
  const transcript = mkTranscriptOfTokens(2000);
  const sessionId = freshSessionId();
  const result = decide(sessionId, transcript, cwd);
  assert.equal(result.fired, true);
  clearState(sessionId);
});

test('respects block mode from config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-depthcheck-blockmode-'));
  fs.writeFileSync(
    path.join(cwd, 'CLAUDE.md'),
    'Some unrelated prose that should not appear.\n<!-- rule-guard:critical -->\n- Only this rule.\n<!-- /rule-guard:critical -->\n'
  );
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'seatbelt.json'), JSON.stringify({ firstFire: 1000, mode: 'block' }));
  const transcript = mkTranscriptOfTokens(2000);
  const sessionId = freshSessionId();
  const result = decide(sessionId, transcript, cwd);
  assert.match(result.context, /Only this rule/);
  assert.doesNotMatch(result.context, /unrelated prose/);
  clearState(sessionId);
});
