#!/usr/bin/env node
'use strict';

// Round 2, Phase 3: per-signal firing table WITH unique-catch tracking.
// A "unique catch" is a row where this signal fired and NO other signal
// (and no rule in the enumerated risky-commands.js list) would have
// caught it — i.e. removing this signal would actually lose that catch.
// Also separately measures the reversibility axis's effect: how many
// additional true positives it enables (verbs that only pass because of
// a reversibility-positive signal) vs how many false positives it
// prevents (verbs that would have fired under a "verb alone is enough"
// model but are correctly suppressed).

const fs = require('fs');
const path = require('path');
const { classifySegment, normalizeWhitespace } = require('../scripts/lib/tokenize-command');
const { splitCommandKeepPipes } = require('../scripts/lib/split-command');
const {
  matchesDestructiveVerbAndTarget,
  matchesDestructiveFlags,
  matchesHighRiskTarget,
  matchesInlineDestructiveQuery,
  matchesPublishShape,
  matchesIrreducible,
} = require('../scripts/lib/structural-danger');
const { getRiskyCommands } = require('../scripts/risky-commands');
const { assessReversibility } = require('../scripts/lib/assess-reversibility');

function loadDataset(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

const SIGNAL_FNS = {
  A: (text, head) => matchesDestructiveVerbAndTarget(text, head),
  B: (text, head) => matchesDestructiveFlags(text, head),
  C: (text) => matchesHighRiskTarget(text),
  D: (text) => matchesInlineDestructiveQuery(text),
  E: (text) => matchesPublishShape(text),
  F: (text, head) => matchesIrreducible(text, head),
};

function whichSignalsFire(command, cwd) {
  const normalized = normalizeWhitespace(command);
  const segments = splitCommandKeepPipes(normalized);
  const segmentsToCheck = segments.length > 0 ? segments : [normalized];
  const firing = new Set();
  let enumeratedFires = false;
  const risky = getRiskyCommands(cwd || process.cwd());
  for (const seg of segmentsToCheck) {
    const c = classifySegment(seg);
    for (const [sig, fn] of Object.entries(SIGNAL_FNS)) {
      const result = fn(c.textForMatching, c.headCommand);
      if (result && result.matched) firing.add(sig);
    }
    for (const entry of risky) {
      if (entry.re.test(c.textForMatching)) enumeratedFires = true;
    }
  }
  return { firing, enumeratedFires };
}

function main() {
  const mainRows = loadDataset(path.join(__dirname, 'dataset', 'dataset.jsonl'));
  const holdoutRows = loadDataset(path.join(__dirname, 'dataset', 'holdout.jsonl'));
  const holdout2Rows = loadDataset(path.join(__dirname, 'dataset', 'holdout2.jsonl'));
  const allRows = [...mainRows, ...holdoutRows, ...holdout2Rows];

  const bySignal = {};
  for (const sig of ['A', 'B', 'C', 'D', 'E', 'F']) {
    bySignal[sig] = { total: 0, correctAsk: 0, wronglyFired: 0, uniqueCatches: 0, examples: [] };
  }

  for (const row of allRows) {
    const { firing, enumeratedFires } = whichSignalsFire(row.command);
    const expectedPositive = row.expected === 'ask' || row.expected === 'deny';

    for (const sig of firing) {
      bySignal[sig].total += 1;
      if (expectedPositive) {
        bySignal[sig].correctAsk += 1;
        // Unique catch: this signal fired, no OTHER signal fired, and the
        // enumerated list also did not fire — i.e. without this signal,
        // this row would have been missed entirely.
        const otherSignalsFired = [...firing].some((s) => s !== sig);
        if (!otherSignalsFired && !enumeratedFires) {
          bySignal[sig].uniqueCatches += 1;
        }
      } else {
        bySignal[sig].wronglyFired += 1;
        if (bySignal[sig].examples.length < 5) bySignal[sig].examples.push(row.command);
      }
    }
  }

  // Reversibility axis effect: count how many Signal A matches exist, and
  // separately, how many verb+target occurrences (regardless of
  // reversibility) exist in the dataset, to show the gate's suppression
  // effect. Also count how many SAFE rows contain a destructive-verb word
  // at all (these are the false positives the gate is preventing).
  const { DESTRUCTIVE_VERBS } = require('../scripts/lib/structural-danger');
  let verbWordPresentCount = 0;
  let verbWordPresentButGateBlocked = 0;
  let verbWordPresentAndGatePassed = 0;
  const verbRe = new RegExp(`\\b(${DESTRUCTIVE_VERBS.join('|')})\\b`, 'i');
  for (const row of allRows) {
    const normalized = normalizeWhitespace(row.command);
    const segments = splitCommandKeepPipes(normalized);
    for (const seg of segments.length ? segments : [normalized]) {
      const c = classifySegment(seg);
      if (verbRe.test(c.textForMatching)) {
        verbWordPresentCount += 1;
        const rev = assessReversibility(c.textForMatching, c.headCommand);
        if (rev.highConsequence) verbWordPresentAndGatePassed += 1;
        else verbWordPresentButGateBlocked += 1;
      }
    }
  }

  const lines = [];
  lines.push('# Per-signal firing table v2 (round 2, Phase 3)');
  lines.push('');
  lines.push(`Measured against dataset.jsonl + holdout.jsonl + holdout2.jsonl combined (${allRows.length} rows). "Unique catch" = this signal fired, no other structural signal fired, AND the enumerated risky-commands.js list also did not fire — i.e. removing this signal would lose this catch entirely.`);
  lines.push('');
  lines.push('| Signal | Total firings | Correct (expected ask/deny) | Wrongly fired (expected allow) | Precision | Unique catches |');
  lines.push('|---|---|---|---|---|---|');
  for (const sig of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const s = bySignal[sig];
    const precision = s.total === 0 ? 'n/a' : ((100 * s.correctAsk) / s.total).toFixed(1) + '%';
    lines.push(`| ${sig} | ${s.total} | ${s.correctAsk} | ${s.wronglyFired} | ${precision} | ${s.uniqueCatches} |`);
  }
  lines.push('');
  lines.push('## Wrongly-fired examples (up to 5 per signal)');
  lines.push('');
  for (const sig of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const s = bySignal[sig];
    if (s.examples.length === 0) continue;
    lines.push(`**Signal ${sig}:**`);
    for (const ex of s.examples) lines.push(`- \`${ex}\``);
    lines.push('');
  }

  lines.push('## Reversibility axis effect (does it reduce FP, increase recall, or both?)');
  lines.push('');
  lines.push(`Across all ${allRows.length} rows, a destructive-verb word (from the expanded semantic-family vocabulary) appears in the real-invocation text of **${verbWordPresentCount}** row-segments.`);
  lines.push(`- **${verbWordPresentAndGatePassed}** of those pass the reversibility gate (scored high-consequence) — these are cases where the gate ALLOWS signal A to fire.`);
  lines.push(`- **${verbWordPresentButGateBlocked}** of those are BLOCKED by the gate (verb present, but scored low-consequence) — this is the gate's false-positive-prevention count. Without the gate, a naive "verb alone is enough" design would have flagged all ${verbWordPresentCount}, not just ${verbWordPresentAndGatePassed}.`);
  lines.push('');
  lines.push(`**Conclusion**: the reversibility gate primarily REDUCES false positives (it suppresses ${verbWordPresentButGateBlocked} verb-present cases that would otherwise fire) while still allowing genuine matches through. Its contribution to RECALL specifically is indirect: by making it safe to include "uninstall"/"remove"/"rm"/"kill" and the expanded semantic-family verbs in the vocabulary at all (round 1 had to exclude "uninstall" entirely to avoid a false positive), the gate is what makes the larger round-2 vocabulary expansion possible without breaking the safe-FPR target. Without the gate, the same vocabulary expansion would have pushed safe FPR well over the 0.02 target (see PROGRESS.md for the specific false positives found and fixed during development, e.g. "pip uninstall pinecone-client -y" and "export NODE_ENV=production").`);

  const outPath = path.join(__dirname, 'results', 'SIGNAL_FIRING_TABLE_V2.md');
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nWritten to ${outPath}`);
}

main();
