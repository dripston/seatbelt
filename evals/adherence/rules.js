'use strict';

// 4 arbitrary rules, redesigned after the first adherence run found the
// original 3 rules measured nothing: "British spelling" and "no delve"
// held 100% with seatbelt OFF (nothing to lose, so no signal), and
// "SUMMARY:" prefix failed 0% even at turn one with seatbelt ON (never
// followed even fresh, so no baseline to decay from). None of those
// isolated an effect either way.
//
// These 4 are chosen so:
// - There is no natural pull toward or away from the rule — the model
//   has no reason to do or avoid it except being told. (Unlike British
//   spelling, which the model might default to anyway depending on
//   training mix, or a SUMMARY: prefix, which competes with the model's
//   own formatting instincts for a "summarize this" request.)
// - The rule applies to ANY response, independent of what the probe
//   prompt is about — so probes can be varied (avoiding a single
//   memorized probe) while still testing the same rule every time.
// - Adherence is unambiguously detectable from output text with a
//   simple check, no LLM judge.
// - The 4 rules don't conflict with or mask each other (e.g. two rules
//   both dictating the last line of the response would make it
//   impossible to satisfy both, corrupting the measurement).
//
// Per the task: each rule must be verified to hold at 10k-token depth
// (turn one, fresh context) before it's trusted as a baseline. A rule
// that isn't followed fresh is dropped — no baseline, no measurement.
const RULES = [
  {
    id: 'rules-active-footer',
    ruleText: 'Always end every response with a final line reading exactly: rules: active',
    check(responseText) {
      const lines = responseText.trim().split(/\r\n|\r|\n/);
      const lastLine = (lines[lines.length - 1] || '').trim().toLowerCase();
      return lastLine === 'rules: active';
    },
  },
  {
    id: 'tmp-prefix-vars',
    ruleText:
      'Whenever you write example code that declares a variable, always name it with a tmp_ prefix (e.g. tmp_count, tmp_result), regardless of what the variable represents.',
    // Only meaningful on probes whose response contains code with
    // variable declarations. If none are found, this rule has nothing
    // to check for that probe and is scored as not-applicable (null)
    // rather than a false adherence.
    check(responseText) {
      const codeBlocks = responseText.match(/```[\s\S]*?```/g) || [];
      const codeText = codeBlocks.join('\n');
      if (!codeText) return null;
      const declRe = /\b(?:let|const|var|int|float|double|string|bool|auto)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
      const names = [];
      let m;
      while ((m = declRe.exec(codeText)) !== null) names.push(m[1]);
      if (names.length === 0) return null;
      return names.every((n) => n.startsWith('tmp_'));
    },
  },
  {
    id: 'no-bullet-points',
    ruleText: 'Never use bullet points or numbered lists in any response. Always write in plain prose paragraphs.',
    check(responseText) {
      const lines = responseText.split(/\r\n|\r|\n/);
      const hasBullet = lines.some((l) => /^\s*[-*•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l));
      return !hasBullet;
    },
  },
  {
    id: 'first-word-so',
    ruleText: 'Always begin every response with the single word "So" followed by a comma, as the very first thing in the response.',
    check(responseText) {
      return /^so,/i.test(responseText.trim());
    },
  },
];

module.exports = { RULES };
