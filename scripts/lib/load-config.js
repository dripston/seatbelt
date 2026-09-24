'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeCwd } = require('./parse-rules');

const DEFAULTS = {
  firstFire: 100000,
  interval: 50000,
  mode: 'auto',
  maxInjectTokens: 1500,
  minTurnsBetween: 10,
};

const CONFIG_REL_PATH = path.join('.claude', 'seatbelt.json');

/**
 * Loads .claude/seatbelt.json from cwd, merged over defaults. Missing
 * file, invalid JSON, or invalid field values all fall back to defaults
 * for that field individually — one bad field never invalidates the
 * whole config. Never throws.
 */
function loadConfig(cwd) {
  const config = { ...DEFAULTS };
  try {
    const abs = path.join(normalizeCwd(cwd), CONFIG_REL_PATH);
    if (!fs.existsSync(abs)) return config;
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return config;

    if (Number.isFinite(parsed.firstFire) && parsed.firstFire > 0) config.firstFire = parsed.firstFire;
    if (Number.isFinite(parsed.interval) && parsed.interval > 0) config.interval = parsed.interval;
    if (parsed.mode === 'block' || parsed.mode === 'full' || parsed.mode === 'auto') config.mode = parsed.mode;
    if (Number.isFinite(parsed.maxInjectTokens) && parsed.maxInjectTokens > 0) {
      config.maxInjectTokens = parsed.maxInjectTokens;
    }
    if (Number.isFinite(parsed.minTurnsBetween) && parsed.minTurnsBetween >= 0) {
      config.minTurnsBetween = parsed.minTurnsBetween;
    }
    return config;
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, DEFAULTS, CONFIG_REL_PATH };
