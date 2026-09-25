'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeCwd, collectSearchDirs } = require('./parse-rules');

const DEFAULTS = {
  firstFire: 100000,
  interval: 50000,
  mode: 'auto',
  maxInjectTokens: 1500,
  minTurnsBetween: 10,
};

const CONFIG_REL_PATH = path.join('.claude', 'seatbelt.json');

/**
 * Attempts to coerce a value to a finite number. Accepts actual numbers
 * and numeric strings (e.g. "50000"). Returns the coerced number, or NaN
 * if it cannot be converted. Used so users who accidentally quote a number
 * in their config still get the right behaviour with a stderr warning.
 */
function coerceNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Finds .claude/seatbelt.json searching cwd first, then walking upward
 * toward a repo boundary or MAX_UPWARD_LEVELS (same traversal as rules
 * file discovery in parse-rules.js), so a config placed at a monorepo's
 * root is still found from a subdirectory session. Returns the absolute
 * path of the first match, or null if none exists anywhere in the
 * search path. Never throws.
 */
function findConfigPath(cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  try {
    for (const dir of collectSearchDirs(normalizedCwd)) {
      const abs = path.join(dir, CONFIG_REL_PATH);
      if (fs.existsSync(abs)) return abs;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

/**
 * Loads .claude/seatbelt.json from cwd or the nearest parent directory
 * that has one (see findConfigPath), merged over defaults. Missing
 * file, invalid JSON, or invalid field values all fall back to defaults
 * for that field individually — one bad field never invalidates the
 * whole config. Numeric fields given as strings (e.g. "50000") are
 * coerced silently with a stderr warning. Never throws.
 */
function loadConfig(cwd) {
  const config = { ...DEFAULTS };
  try {
    const abs = findConfigPath(cwd);
    if (!abs) return config;
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return config;

    for (const field of ['firstFire', 'interval', 'maxInjectTokens', 'minTurnsBetween']) {
      if (!(field in parsed)) continue;
      const raw_val = parsed[field];
      const n = coerceNumber(raw_val);
      const isValid = field === 'minTurnsBetween' ? n >= 0 : n > 0;
      if (Number.isFinite(n) && isValid) {
        if (typeof raw_val === 'string') {
          try {
            process.stderr.write(
              `seatbelt: config field "${field}" is a string ("${raw_val}") — expected a number. Coercing it for you, but please fix your seatbelt.json.\n`
            );
          } catch (_ignored) {}
        }
        config[field] = n;
      }
    }

    if (parsed.mode === 'block' || parsed.mode === 'full' || parsed.mode === 'auto') config.mode = parsed.mode;
    return config;
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, findConfigPath, DEFAULTS, CONFIG_REL_PATH };
