'use strict';

/**
 * Splits a shell command string into segments on &&, ;, and |, so each
 * can be checked independently against guard/risky patterns. This is a
 * pragmatic tokenizer, not a full shell parser: it respects single and
 * double quotes (so a quoted string containing "&&" or "|" is not split),
 * but does not handle every POSIX edge case. Fail-open philosophy: if
 * something looks ambiguous, prefer returning the whole string as one
 * segment over throwing.
 */
function splitCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return [];

  const segments = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '&' && next === '&') {
        segments.push(current);
        current = '';
        i++; // skip second '&'
        continue;
      }
      if (ch === ';' || ch === '|') {
        // Don't split on '||' incorrectly: treat each '|' the same,
        // since either way both sides are separate commands to check.
        segments.push(current);
        current = '';
        continue;
      }
    }

    current += ch;
  }
  segments.push(current);

  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

module.exports = { splitCommand };
