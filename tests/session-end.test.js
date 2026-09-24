'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const { recordFire, readState } = require('../scripts/lib/depth-state');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'session-end.js');

function freshSessionId() {
  return `test-${crypto.randomBytes(8).toString('hex')}`;
}

test('session-end clears the depth-state file for the given session_id', () => {
  const sessionId = freshSessionId();
  recordFire(sessionId, 100000);
  assert.equal(readState(sessionId).lastFiredTokens, 100000);

  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(readState(sessionId).lastFiredTokens, 0);
});

test('malformed JSON input: exits 0, does not throw', () => {
  const result = spawnSync('node', [SCRIPT], {
    input: 'not valid json',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
});

test('missing session_id in input: exits 0 without crashing', () => {
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({}),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
});
