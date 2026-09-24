#!/usr/bin/env node
'use strict';

// Runs the held-out generalization-check dataset (evals/dataset/holdout3.jsonl)
// through the exact same production code path as run-classifier-eval.js —
// the real scripts/pre-bash.js, invoked as a child process via stdin,
// unmodified. This driver duplicates only run-classifier-eval.js's harness
// plumbing (which isn't exported/importable) so that file can stay
// untouched, as instructed; the actual matching logic under test
// (scripts/pre-bash.js and everything it requires) is not touched or
// duplicated at all.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRE_BASH = path.join(__dirname, '..', 'scripts', 'pre-bash.js');
const DATASET_PATH = path.join(__dirname, 'dataset', 'holdout3.jsonl');
const RESULTS_DIR = path.join(__dirname, 'results');

function loadDataset() {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function materializeProject(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-holdout-'));
  if (rules === null || rules === undefined) {
    return dir;
  }
  if (rules === '(empty block)') {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- rule-guard:critical -->\n<!-- /rule-guard:critical -->\n');
    return dir;
  }
  if (typeof rules === 'string' && rules.startsWith('__AGENTS_MD__:')) {
    const body = rules.slice('__AGENTS_MD__:'.length);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `<!-- rule-guard:critical -->\n${body}\n<!-- /rule-guard:critical -->\n`);
    return dir;
  }
  if (typeof rules === 'string' && rules.trim().startsWith('<!--')) {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), rules + '\n');
    return dir;
  }
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `<!-- rule-guard:critical -->\n${rules}\n<!-- /rule-guard:critical -->\n`);
  return dir;
}

function runHook(command, cwd) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  const start = process.hrtime.bigint();
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('node', [PRE_BASH], { input, encoding: 'utf8', timeout: 5000, cwd });
  } catch (err) {
    exitCode = typeof err.status === 'number' ? err.status : 1;
    stdout = err.stdout ? err.stdout.toString() : '';
  }
  const end = process.hrtime.bigint();
  const latencyMs = Number(end - start) / 1e6;

  let predicted = 'allow';
  let reason = null;
  if (stdout && stdout.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(stdout);
      const decision = parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision;
      if (decision === 'deny' || decision === 'ask' || decision === 'allow') {
        predicted = decision;
      }
      reason = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason) || null;
    } catch (_e) {
      // unparsable output: treat as allow (matches hook's own documented fallback)
    }
  }

  return { predicted, reason, latencyMs, exitCode };
}

function main() {
  const dataset = loadDataset();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const results = [];
  for (const row of dataset) {
    const dir = materializeProject(row.rules);
    const { predicted, reason, latencyMs, exitCode } = runHook(row.command, dir);
    results.push({
      id: row.id,
      command: row.command,
      expected: row.expected,
      predicted,
      correct: predicted === row.expected,
      reason,
      latencyMs: Math.round(latencyMs * 100) / 100,
      exitCode,
      source: row.source,
      category: row.category,
      rationale: row.rationale,
    });
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort cleanup
    }
  }

  const outPath = path.join(RESULTS_DIR, 'holdout3-raw.jsonl');
  fs.writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const correct = results.filter((r) => r.correct).length;
  console.log(`Ran ${results.length} held-out (3rd set) rows through the real pre-bash.js hook.`);
  console.log(`${correct}/${results.length} matched expected label (${((100 * correct) / results.length).toFixed(1)}%).`);
  console.log(`Raw results written to ${outPath}`);
}

main();
