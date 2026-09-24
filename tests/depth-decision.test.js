'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldFire } = require('../scripts/lib/depth-decision');

const CONFIG = { firstFire: 100000, interval: 50000, minTurnsBetween: 10 };
const FRESH_STATE = { lastFiredTokens: 0, turnsSinceLastFire: Infinity };

test('below firstFire threshold: does not fire', () => {
  assert.equal(shouldFire(99999, FRESH_STATE, CONFIG), false);
});

test('at exactly firstFire threshold: fires', () => {
  assert.equal(shouldFire(100000, FRESH_STATE, CONFIG), true);
});

test('above firstFire threshold: fires', () => {
  assert.equal(shouldFire(150000, FRESH_STATE, CONFIG), true);
});

test('zero or negative estimated tokens: never fires', () => {
  assert.equal(shouldFire(0, FRESH_STATE, CONFIG), false);
  assert.equal(shouldFire(-5, FRESH_STATE, CONFIG), false);
});

test('non-finite estimated tokens: never fires (fail open, no crash)', () => {
  assert.equal(shouldFire(NaN, FRESH_STATE, CONFIG), false);
  assert.equal(shouldFire(Infinity, FRESH_STATE, CONFIG), false);
});

test('already fired once: does not re-fire until a full interval past last fire', () => {
  const state = { lastFiredTokens: 100000, turnsSinceLastFire: Infinity };
  assert.equal(shouldFire(120000, state, CONFIG), false);
  assert.equal(shouldFire(149999, state, CONFIG), false);
  assert.equal(shouldFire(150000, state, CONFIG), true);
});

test('interval fires are relative to lastFiredTokens, not a fixed multiple of firstFire', () => {
  // Simulates firing early somehow (e.g. a config change) at 110000.
  const state = { lastFiredTokens: 110000, turnsSinceLastFire: Infinity };
  assert.equal(shouldFire(159999, state, CONFIG), false);
  assert.equal(shouldFire(160000, state, CONFIG), true);
});

test('turn floor blocks a fire even when token threshold is crossed', () => {
  const state = { lastFiredTokens: 0, turnsSinceLastFire: 3 };
  assert.equal(shouldFire(200000, state, CONFIG), false);
});

test('turn floor satisfied exactly at minTurnsBetween: fires', () => {
  const state = { lastFiredTokens: 0, turnsSinceLastFire: 10 };
  assert.equal(shouldFire(200000, state, CONFIG), true);
});

test('turn floor of Infinity (never fired, fresh session) never blocks', () => {
  assert.equal(shouldFire(100000, { lastFiredTokens: 0, turnsSinceLastFire: Infinity }, CONFIG), true);
});

test('minTurnsBetween of 0 never blocks on the turn floor', () => {
  const config = { ...CONFIG, minTurnsBetween: 0 };
  const state = { lastFiredTokens: 100000, turnsSinceLastFire: 0 };
  assert.equal(shouldFire(150000, state, config), true);
});

test('custom firstFire/interval config values are respected', () => {
  const config = { firstFire: 25000, interval: 10000, minTurnsBetween: 1 };
  assert.equal(shouldFire(24999, FRESH_STATE, config), false);
  assert.equal(shouldFire(25000, FRESH_STATE, config), true);
});
