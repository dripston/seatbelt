'use strict';

const fs = require('fs');
const { CHARS_PER_TOKEN } = require('./select-content');

// Reading and JSON-parsing every line of a large transcript is the
// expensive path (a long session's transcript can be many MB). This hook
// runs on every UserPromptSubmit, so it needs a cheap estimate, not an
// exact count. Strategy: if the file is small enough, read and count it
// exactly; otherwise estimate from file size alone (a JSONL transcript's
// byte size correlates closely enough with token count for a threshold
// decision — we only need to know which side of 100k/150k/200k we're on,
// not the exact figure).
const EXACT_READ_MAX_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Estimates total tokens represented by a transcript JSONL file.
 * Never throws; returns 0 if the file can't be read at all (fails open
 * to "not over threshold" rather than blocking/erroring).
 */
function estimateTranscriptTokens(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return 0;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size <= EXACT_READ_MAX_BYTES) {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      return Math.ceil(content.length / CHARS_PER_TOKEN);
    }
    // Large file: byte size is itself a fine proxy for character count
    // for JSONL transcript content (predominantly ASCII/UTF-8 text).
    return Math.ceil(stat.size / CHARS_PER_TOKEN);
  } catch (_err) {
    return 0;
  }
}

module.exports = { estimateTranscriptTokens, EXACT_READ_MAX_BYTES };
