'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { readState, recordFire, recordTurnWithoutFiring, clearState, statePath, pruneStaleSeatbeltFiles } = require('../scripts/lib/depth-state');

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

test('pruneStaleSeatbeltFiles removes files older than 48h, leaves fresh ones', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const staleId = freshSessionId();
  const freshId = freshSessionId();

  recordFire(staleId, 1000);
  recordFire(freshId, 2000);

  // Back-date the stale file's mtime to 49 hours ago
  const staleFile = statePath(staleId);
  const staleTime = new Date(Date.now() - 49 * 60 * 60 * 1000);
  fs.utimesSync(staleFile, staleTime, staleTime);

  pruneStaleSeatbeltFiles({ force: true });

  // Stale file should be gone
  assert.ok(!fs.existsSync(staleFile), 'stale file should have been pruned');
  // Fresh file should still be there
  const freshFile = statePath(freshId);
  assert.ok(fs.existsSync(freshFile), 'fresh file should not be pruned');
  clearState(freshId);
});

test('pruneStaleSeatbeltFiles does not throw on an empty or missing tmpdir listing', () => {
  assert.doesNotThrow(() => pruneStaleSeatbeltFiles());
});

test('readState throttles the prune sweep instead of scanning tmpdir on every call', () => {
  const fs = require('fs');
  const staleId = freshSessionId();
  recordFire(staleId, 1000);
  const staleFile = statePath(staleId);
  const staleTime = new Date(Date.now() - 49 * 60 * 60 * 1000);
  fs.utimesSync(staleFile, staleTime, staleTime);

  // Force one sweep so the throttle window starts now, then immediately
  // create another stale file and call readState (which triggers an
  // un-forced prune internally) many times in a tight loop, simulating
  // many prompts in one session. If readState swept every time, this
  // loop would be doing a full tmpdir scan per call — instead only the
  // first (already-forced) sweep should have run, so the second stale
  // file must survive until the throttle window elapses.
  pruneStaleSeatbeltFiles({ force: true });
  const staleId2 = freshSessionId();
  recordFire(staleId2, 1000);
  const staleFile2 = statePath(staleId2);
  fs.utimesSync(staleFile2, staleTime, staleTime);

  for (let i = 0; i < 20; i++) {
    readState(staleId2);
  }

  assert.ok(fs.existsSync(staleFile2), 'throttled readState should not have re-swept tmpdir on every call');
  clearState(staleId2);
});
