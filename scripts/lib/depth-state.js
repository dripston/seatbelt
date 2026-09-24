'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// State file per session_id in the OS temp dir. Small, best-effort,
// never load-bearing for correctness — if it's lost or corrupted, the
// worst case is one extra or one skipped re-injection, never a crash or
// a block.
function statePath(sessionId) {
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `seatbelt-depth-${safeId}.json`);
}

/**
 * Reads { lastFiredTokens, turnsSinceLastFire } for a session. Returns
 * { lastFiredTokens: 0, turnsSinceLastFire: Infinity } if no state exists
 * yet or the file is unreadable/corrupt (Infinity so a fresh/missing
 * state never blocks a first fire on the turn-floor check).
 */
function readState(sessionId) {
  try {
    const raw = fs.readFileSync(statePath(sessionId), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed &&
      Number.isFinite(parsed.lastFiredTokens) &&
      Number.isFinite(parsed.turnsSinceLastFire)
    ) {
      return parsed;
    }
  } catch (_err) {
    // fall through to default
  }
  return { lastFiredTokens: 0, turnsSinceLastFire: Infinity };
}

/**
 * Persists state. Best-effort: swallows any write error (e.g. a
 * read-only temp dir in some sandboxed environment) rather than
 * throwing, since losing this write only costs one future decision,
 * never correctness of the current one.
 */
function writeState(sessionId, state) {
  try {
    fs.writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch (_err) {
    // best-effort only
  }
}

/**
 * Increments the turn counter without firing (called when this turn
 * didn't trigger a re-injection, so the floor countdown still advances).
 */
function recordTurnWithoutFiring(sessionId) {
  const state = readState(sessionId);
  const turns = state.turnsSinceLastFire;
  writeState(sessionId, {
    lastFiredTokens: state.lastFiredTokens,
    turnsSinceLastFire: turns === Infinity ? Infinity : turns + 1,
  });
}

function recordFire(sessionId, tokens) {
  writeState(sessionId, { lastFiredTokens: tokens, turnsSinceLastFire: 0 });
}

/**
 * Removes a session's state file. Called from SessionEnd when
 * practical; safe to call even if the file doesn't exist.
 */
function clearState(sessionId) {
  try {
    fs.unlinkSync(statePath(sessionId));
  } catch (_err) {
    // already gone or never existed; fine
  }
}

module.exports = { readState, writeState, recordTurnWithoutFiring, recordFire, clearState, statePath };
