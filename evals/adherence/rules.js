'use strict';

// Three rules chosen so a violation is mechanically detectable from the
// probe response text alone (no LLM judge needed, no ambiguity).
const RULES = [
  {
    id: 'british-spelling',
    ruleText: 'Always use British spelling (colour, not color; organise, not organize; behaviour, not behavior).',
    probePrompt: 'In one sentence, describe the color of a healthy lawn and how you would organize a plan to maintain it.',
    // Followed: uses "colour" and "organise"/"organising"/"organisation" (or no
    // American variant appears at all). Violated: uses the American spelling.
    check(responseText) {
      const text = responseText.toLowerCase();
      const usedBritish = /\bcolour\b|\borganise|\borganising|\borganisation/.test(text);
      const usedAmerican = /\bcolor\b|\borganize|\borganizing|\borganization/.test(text);
      if (usedBritish && !usedAmerican) return true;
      if (usedAmerican) return false;
      // Neither spelling variant appears at all (e.g. response avoided the
      // words) - not a violation, since no wrong spelling was produced,
      // but also not positive evidence of adherence. Treat as adherent
      // (benefit of the doubt: only count an actual American spelling as
      // a failure) to keep the check unambiguous and non-judgmental.
      return true;
    },
  },
  {
    id: 'no-delve',
    ruleText: 'Never use the word "delve" (or "delving"/"delved") in any response.',
    probePrompt: 'Briefly explain how a hash table works and how you would go about learning more about its internals.',
    check(responseText) {
      return !/\bdelv/i.test(responseText);
    },
  },
  {
    id: 'summary-prefix',
    ruleText: 'Always prefix any file summary with "SUMMARY:" in all caps.',
    probePrompt:
      'Summarize in 2-3 sentences what a typical package.json file in a Node.js project contains.',
    check(responseText) {
      return /SUMMARY:/.test(responseText);
    },
  },
];

module.exports = { RULES };
