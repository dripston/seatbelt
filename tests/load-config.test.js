'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig, DEFAULTS } = require('../scripts/lib/load-config');

function mkProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-config-'));
}

function writeConfig(dir, content) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'seatbelt.json'), content);
}

test('no config file: returns defaults', () => {
  const dir = mkProject();
  assert.deepEqual(loadConfig(dir), DEFAULTS);
});

test('valid config overrides all fields', () => {
  const dir = mkProject();
  writeConfig(
    dir,
    JSON.stringify({
      firstFire: 50000,
      interval: 25000,
      mode: 'full',
      maxInjectTokens: 3000,
      minTurnsBetween: 5,
    })
  );
  const config = loadConfig(dir);
  assert.equal(config.firstFire, 50000);
  assert.equal(config.interval, 25000);
  assert.equal(config.mode, 'full');
  assert.equal(config.maxInjectTokens, 3000);
  assert.equal(config.minTurnsBetween, 5);
});

test('partial config: unspecified fields fall back to defaults', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ mode: 'block' }));
  const config = loadConfig(dir);
  assert.equal(config.mode, 'block');
  assert.equal(config.firstFire, DEFAULTS.firstFire);
  assert.equal(config.interval, DEFAULTS.interval);
});

test('invalid mode string: falls back to default mode, other fields still apply', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ mode: 'nonsense', firstFire: 75000 }));
  const config = loadConfig(dir);
  assert.equal(config.mode, DEFAULTS.mode);
  assert.equal(config.firstFire, 75000);
});

test('negative or zero numeric fields fall back to defaults', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ firstFire: -5, interval: 0, maxInjectTokens: -100 }));
  const config = loadConfig(dir);
  assert.equal(config.firstFire, DEFAULTS.firstFire);
  assert.equal(config.interval, DEFAULTS.interval);
  assert.equal(config.maxInjectTokens, DEFAULTS.maxInjectTokens);
});

test('malformed JSON: returns defaults, does not throw', () => {
  const dir = mkProject();
  writeConfig(dir, '{ this is not valid json');
  assert.doesNotThrow(() => {
    const config = loadConfig(dir);
    assert.deepEqual(config, DEFAULTS);
  });
});

test('config is not an object (e.g. a JSON array): returns defaults', () => {
  const dir = mkProject();
  writeConfig(dir, '[1, 2, 3]');
  assert.deepEqual(loadConfig(dir), DEFAULTS);
});

test('minTurnsBetween of 0 is valid (not treated as falsy-invalid)', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ minTurnsBetween: 0 }));
  const config = loadConfig(dir);
  assert.equal(config.minTurnsBetween, 0);
});

test('string numeric values are coerced to numbers', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ firstFire: '50000', interval: '25000', maxInjectTokens: '2000', minTurnsBetween: '5' }));
  const config = loadConfig(dir);
  assert.equal(config.firstFire, 50000);
  assert.equal(config.interval, 25000);
  assert.equal(config.maxInjectTokens, 2000);
  assert.equal(config.minTurnsBetween, 5);
});

test('non-numeric string values for numeric fields fall back to defaults', () => {
  const dir = mkProject();
  writeConfig(dir, JSON.stringify({ firstFire: 'lots', interval: 'many' }));
  const config = loadConfig(dir);
  assert.equal(config.firstFire, DEFAULTS.firstFire);
  assert.equal(config.interval, DEFAULTS.interval);
});

test('config at repo root is found from a monorepo subdirectory', () => {
  const root = mkProject();
  writeConfig(root, JSON.stringify({ firstFire: 12345, mode: 'block' }));
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });

  const config = loadConfig(sub);
  assert.equal(config.firstFire, 12345);
  assert.equal(config.mode, 'block');
});

test('a nearer config wins over a root config when both exist', () => {
  const root = mkProject();
  writeConfig(root, JSON.stringify({ firstFire: 11111 }));
  const sub = path.join(root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });
  writeConfig(sub, JSON.stringify({ firstFire: 22222 }));

  const config = loadConfig(sub);
  assert.equal(config.firstFire, 22222);
});
