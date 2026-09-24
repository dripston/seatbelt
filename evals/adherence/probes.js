'use strict';

// Generic probe prompts, independent of any specific rule. Each probe's
// single response is checked against all 4 rules in rules.js at once
// (rules apply to any response, not to a specific probe's topic) — this
// is what lets "multiple probes per depth" catch a single-response fluke
// without needing a separate probe per rule. Varied topics and a mix of
// prose-only and code-bearing requests, so tmp-prefix-vars has material
// to check on at least some probes per checkpoint, and no-bullet-points/
// first-word-so/rules-active-footer are exercised on every probe
// regardless of topic.
const PROBES = [
  'Explain in a short paragraph why leap years exist.',
  'Write a short JavaScript function that reverses a string, with a brief explanation.',
  'Explain in a short paragraph what causes tides.',
  'Write a short Python function that checks if a number is prime, with a brief explanation.',
];

module.exports = { PROBES };
