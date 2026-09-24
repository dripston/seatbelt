'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { readState, recordFire, recordTurnWithoutFiring, clearState, statePath } = require('../scripts/lib/depth-state');

function freshSessionId() {
  return `test-${crypto.randomBytes(8).toString('hex')}`;
}

test('no state file yet: returns default (never fired, infinite turns since fire)', () => {
  const id = freshSessionId();
  const state = readState(id);
  assert.equal(state.lastFiredTokens, 0);
  assert.equal(state.turnsSinceLastFire, Infinity);
});

test('recordFire persists lastFiredTokens and resets turn counter to 0', () => {
  const id = freshSessionId();
  recordFire(id, 100000);
  const state = readState(id);
  assert.equal(state.lastFiredTokens, 100000);
  assert.equal(state.turnsSinceLastFire, 0);
  clearState(id);
});

test('recordTurnWithoutFiring increments the turn counter', () => {
  const id = freshSessionId();
  recordFire(id, 50000);
  recordTurnWithoutFiring(id);
  recordTurnWithoutFiring(id);
  const state = readState(id);
  assert.equal(state.turnsSinceLastFire, 2);
  assert.equal(state.lastFiredTokens, 50000);
  clearState(id);
});

test('recordTurnWithoutFiring on a never-fired session keeps turns at Infinity', () => {
  const id = freshSessionId();
  recordTurnWithoutFiring(id);
  const state = readState(id);
  assert.equal(state.turnsSinceLastFire, Infinity);
  clearState(id);
});

test('clearState removes the file; subsequent read returns defaults', () => {
  const id = freshSessionId();
  recordFire(id, 100000);
  clearState(id);
  const state = readState(id);
  assert.equal(state.lastFiredTokens, 0);
  assert.equal(state.turnsSinceLastFire, Infinity);
});

test('clearState on a session with no file does not throw', () => {
  const id = freshSessionId();
  assert.doesNotThrow(() => clearState(id));
});

test('corrupted state file: readState falls back to defaults, does not throw', () => {
  const fs = require('fs');
  const id = freshSessionId();
  fs.writeFileSync(statePath(id), 'not valid json{{{');
  assert.doesNotThrow(() => {
    const state = readState(id);
    assert.equal(state.lastFiredTokens, 0);
    assert.equal(state.turnsSinceLastFire, Infinity);
  });
  clearState(id);
});

test('session id is sanitized to a safe filename (path traversal characters stripped)', () => {
  const dangerousId = '../../etc/passwd';
  assert.doesNotThrow(() => {
    recordFire(dangerousId, 1000);
    const state = readState(dangerousId);
    assert.equal(state.lastFiredTokens, 1000);
    clearState(dangerousId);
  });
});

test('state for different session ids is independent', () => {
  const id1 = freshSessionId();
  const id2 = freshSessionId();
  recordFire(id1, 100000);
  recordFire(id2, 50000);
  assert.equal(readState(id1).lastFiredTokens, 100000);
  assert.equal(readState(id2).lastFiredTokens, 50000);
  clearState(id1);
  clearState(id2);
});
