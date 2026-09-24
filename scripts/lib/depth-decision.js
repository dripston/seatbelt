'use strict';

/**
 * Pure firing-logic decision, exported for tests without needing a real
 * transcript file or temp-dir state. Never throws.
 *
 * @param {number} estimatedTokens current estimated transcript size
 * @param {{lastFiredTokens: number, turnsSinceLastFire: number}} state
 * @param {{firstFire: number, interval: number, minTurnsBetween: number}} config
 * @returns {boolean} whether this turn should fire a re-injection
 */
function shouldFire(estimatedTokens, state, config) {
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) return false;

  const turnFloorSatisfied = state.turnsSinceLastFire === Infinity || state.turnsSinceLastFire >= config.minTurnsBetween;
  if (!turnFloorSatisfied) return false;

  if (state.lastFiredTokens === 0) {
    // Never fired yet this session: fire once we cross firstFire.
    return estimatedTokens >= config.firstFire;
  }

  // Already fired at least once: fire again once we've moved a full
  // interval past the last fire point.
  return estimatedTokens >= state.lastFiredTokens + config.interval;
}

module.exports = { shouldFire };
