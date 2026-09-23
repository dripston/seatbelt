'use strict';

/**
 * Core splitter: breaks a command string on the given single-character
 * delimiters (plus literal "&&" as a two-character case), respecting
 * single/double quotes so a delimiter inside a quoted string is not
 * treated as a real separator. Fail-open philosophy: if something looks
 * ambiguous, prefer returning the whole string as one segment over
 * throwing.
 */
function splitOn(command, singleCharDelims, splitOnDoubleAmp) {
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
      if (splitOnDoubleAmp && ch === '&' && next === '&') {
        segments.push(current);
        current = '';
        i++; // skip second '&'
        continue;
      }
      if (singleCharDelims.includes(ch)) {
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

/**
 * Splits a shell command string into segments on &&, ;, and |, so each
 * can be checked independently against guard/risky patterns. This is a
 * pragmatic tokenizer, not a full shell parser: it respects single and
 * double quotes (so a quoted string containing "&&" or "|" is not split),
 * but does not handle every POSIX edge case.
 */
function splitCommand(command) {
  return splitOn(command, [';', '|'], true);
}

/**
 * Splits a shell command string into segments on && and ; ONLY — NOT on
 * pipe (|). Used ahead of tokenize-command.js's classifySegment, which
 * needs to see an unsplit "a | b" relationship intact to correctly detect
 * when piping into a shell interpreter (e.g. "echo '...' | bash") turns
 * an otherwise-inert quoted string into a real invocation. classifySegment
 * does its own internal pipe-splitting once it has the full segment.
 * Splitting on pipe here first, before classifySegment ever sees it,
 * would silently defeat that evaluator-detection logic — this was a real,
 * confirmed bug found in the fix-pass (Phase 5 re-evaluation; see
 * evals/results/VERDICT-2.md).
 */
function splitCommandKeepPipes(command) {
  return splitOn(command, [';'], true);
}

module.exports = { splitCommand, splitCommandKeepPipes };
