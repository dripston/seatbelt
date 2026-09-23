#!/usr/bin/env node
'use strict';

// Phase 2: per-signal firing table. Runs every row of BOTH the main
// dataset and the (now burned) first holdout through classifySegment +
// evaluateStructuralDanger directly (in-process, not via the hook
// subprocess) so we can see exactly which signal fired for each row and
// whether that firing was correct, independent of whatever the
// enumerated risky-commands.js list also catches.

const fs = require('fs');
const path = require('path');
const { classifySegment, normalizeWhitespace } = require('../scripts/lib/tokenize-command');
const { splitCommandKeepPipes } = require('../scripts/lib/split-command');
const { evaluateStructuralDanger } = require('../scripts/lib/structural-danger');

function loadDataset(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function whichSignalFires(command) {
  const normalized = normalizeWhitespace(command);
  const segments = splitCommandKeepPipes(normalized);
  const segmentsToCheck = segments.length > 0 ? segments : [normalized];
  for (const seg of segmentsToCheck) {
    const c = classifySegment(seg);
    const result = evaluateStructuralDanger(c.textForMatching, c.headCommand);
    if (result) return result.signal;
  }
  return null;
}

function main() {
  const mainRows = loadDataset(path.join(__dirname, 'dataset', 'dataset.jsonl'));
  const holdoutRows = loadDataset(path.join(__dirname, 'dataset', 'holdout.jsonl'));
  const allRows = [...mainRows, ...holdoutRows];

  const bySignal = {}; // signal -> { total, correct, examples: [] }
  for (const sig of ['A', 'B', 'C', 'D', 'E', 'F']) {
    bySignal[sig] = { total: 0, correctAsk: 0, wronglyFired: 0, examples: [] };
  }

  for (const row of allRows) {
    const signal = whichSignalFires(row.command);
    if (!signal) continue;
    bySignal[signal].total += 1;
    // "Correct" here means the expected label was ask or deny (structural
    // detection only ever proposes "ask", so firing on an "allow"-expected
    // row is a false positive for that signal specifically — note other
    // mechanisms, like the enumerated list or a guard rule, could still
    // independently produce the correct final decision even when a
    // signal "wrongly" fires here, since this measures the signal in
    // isolation, not the final hook output).
    if (row.expected === 'ask' || row.expected === 'deny') {
      bySignal[signal].correctAsk += 1;
    } else {
      bySignal[signal].wronglyFired += 1;
      if (bySignal[signal].examples.length < 5) {
        bySignal[signal].examples.push(row.command);
      }
    }
  }

  const lines = [];
  lines.push('# Per-signal firing table (Phase 2)');
  lines.push('');
  lines.push('Measures each structural-danger signal in ISOLATION against the full 518-row main dataset + the 40-row (burned) first holdout, 558 rows total. "Correct" = the signal fired on a row whose expected label was ask/deny. "Wrongly fired" = the signal fired on a row whose expected label was allow (a false positive for that signal specifically — the final hook decision may still be correct via a different path, e.g. a guard rule, but this isolates each signal\'s own precision).');
  lines.push('');
  lines.push('| Signal | Total firings | Correct (expected ask/deny) | Wrongly fired (expected allow) | Precision |');
  lines.push('|---|---|---|---|---|');
  for (const sig of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const s = bySignal[sig];
    const precision = s.total === 0 ? 'n/a' : ((100 * s.correctAsk) / s.total).toFixed(1) + '%';
    lines.push(`| ${sig} | ${s.total} | ${s.correctAsk} | ${s.wronglyFired} | ${precision} |`);
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

  const outPath = path.join(__dirname, 'results', 'SIGNAL_FIRING_TABLE.md');
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nWritten to ${outPath}`);
}

main();
