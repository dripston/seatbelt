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

// Max age for a state file before it's considered stale (48 hours).
// This handles the case where Claude Code is killed with Ctrl+C or crashes,
// preventing the SessionEnd hook from firing and cleaning up the file.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

// Minimum gap between prune sweeps, tracked in-process. readState() runs on
// every UserPromptSubmit (every single prompt, not once per session), and a
// full tmpdir readdirSync+statSync sweep on every prompt is real, needless
// per-invocation overhead on a busy shared temp dir. This throttles the
// sweep to once per process lifetime interval rather than once per prompt.
// A fresh process (a new hook invocation) always re-checks, since Node
// module state doesn't persist between separate `node depth-check.js`
// invocations — so this mainly protects a single long session with many
// prompts sharing one process, and is cheap insurance either way.
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let lastPruneAt = 0;

/**
 * Sweeps the OS temp directory for seatbelt state files older than
 * STALE_AFTER_MS and removes them. Best-effort: silently ignores any
 * errors so a restrictive temp-dir permission never causes a crash.
 * Throttled to at most once per PRUNE_INTERVAL_MS per process, since
 * readState() calls this on every UserPromptSubmit — pass { force: true }
 * to bypass the throttle (used by tests, which need a deterministic
 * sweep regardless of what other tests already triggered).
 */
function pruneStaleSeatbeltFiles(options) {
  const force = options && options.force;
  const now = Date.now();
  if (!force && now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (!entry.startsWith('seatbelt-depth-')) continue;
      try {
        const full = path.join(tmpDir, entry);
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > STALE_AFTER_MS) {
          fs.unlinkSync(full);
        }
      } catch (_e) {
        // best-effort: skip unreadable/already-deleted entries
      }
    }
  } catch (_err) {
    // best-effort only; a restrictive tmpdir never causes a crash
  }
}

/**
 * Reads { lastFiredTokens, turnsSinceLastFire } for a session. Returns
 * { lastFiredTokens: 0, turnsSinceLastFire: Infinity } if no state exists
 * yet or the file is unreadable/corrupt (Infinity so a fresh/missing
 * state never blocks a first fire on the turn-floor check).
 *
 * Also lazily prunes stale state files left behind by crashed/killed
 * sessions (e.g. Ctrl+C preventing the SessionEnd hook from firing).
 */
function readState(sessionId) {
  // Prune stale orphan files from previous crashed sessions. Called here
  // rather than at module load time so it only runs when seatbelt is
  // actually active for a session, not on every require().
  pruneStaleSeatbeltFiles();
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

module.exports = { readState, writeState, recordTurnWithoutFiring, recordFire, clearState, statePath, pruneStaleSeatbeltFiles };
