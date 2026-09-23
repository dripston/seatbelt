#!/usr/bin/env node
'use strict';

// Phase D: runs the full dataset through the real pre-bash.js hook three
// times, once per risky-command-list configuration (STRICT/CURRENT/LOOSE),
// using the plugin's own documented rule-guard.config.json override
// mechanism so each run exercises the real code path.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRE_BASH = path.join(__dirname, '..', 'scripts', 'pre-bash.js');
const DATASET_PATH = path.join(__dirname, 'dataset', 'dataset.jsonl');
const RESULTS_DIR = path.join(__dirname, 'results');
const { STRICT, CURRENT, LOOSE } = require('./tuning-configs');

function loadDataset() {
  return fs
    .readFileSync(DATASET_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function materializeProject(rules, riskyCommands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-guard-tuning-'));
  if (riskyCommands) {
    fs.writeFileSync(path.join(dir, 'rule-guard.config.json'), JSON.stringify({ riskyCommands }));
  }
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
  let stdout = '';
  try {
    stdout = execFileSync('node', [PRE_BASH], { input, encoding: 'utf8', timeout: 5000, cwd });
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : '';
  }
  let predicted = 'allow';
  if (stdout && stdout.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(stdout);
      const decision = parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision;
      if (decision === 'deny' || decision === 'ask' || decision === 'allow') predicted = decision;
    } catch (_e) {
      // fall through to allow
    }
  }
  return predicted;
}

function runConfig(name, riskyCommands, dataset) {
  const results = [];
  for (const row of dataset) {
    const dir = materializeProject(row.rules, riskyCommands);
    const predicted = runHook(row.command, dir);
    results.push({ ...row, predicted, correct: predicted === row.expected });
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort
    }
  }

  const safeRows = results.filter((r) => r.category === 'safe-everyday');
  const safeFP = safeRows.filter((r) => r.predicted !== 'allow').length;
  const safeFPR = safeRows.length === 0 ? null : safeFP / safeRows.length;

  const dangerousRows = results.filter((r) => r.category === 'dangerous-guarded' || r.category === 'dangerous-builtin');
  const dangerousCaught = dangerousRows.filter((r) => r.predicted === 'deny' || r.predicted === 'ask').length;
  const dangerousRecall = dangerousRows.length === 0 ? null : dangerousCaught / dangerousRows.length;

  const denyTP = results.filter((r) => r.expected === 'deny' && r.predicted === 'deny').length;
  const denyFP = results.filter((r) => r.expected !== 'deny' && r.predicted === 'deny').length;
  const denyPrecision = denyTP + denyFP === 0 ? null : denyTP / (denyTP + denyFP);

  const nearMissRows = results.filter((r) => r.category === 'near-miss');
  const nearMissFP = nearMissRows.filter((r) => r.predicted !== 'allow').length;
  const nearMissFPR = nearMissRows.length === 0 ? null : nearMissFP / nearMissRows.length;

  return {
    name,
    total: results.length,
    safeFPR,
    safeFP,
    safeTotal: safeRows.length,
    dangerousRecall,
    dangerousCaught,
    dangerousTotal: dangerousRows.length,
    denyPrecision,
    nearMissFPR,
    nearMissFP,
    nearMissTotal: nearMissRows.length,
  };
}

function main() {
  const dataset = loadDataset();
  console.log(`Running ${dataset.length} rows through 3 configurations...`);

  const strictResult = runConfig('STRICT', STRICT, dataset);
  console.log('STRICT done.');
  const currentResult = runConfig('CURRENT (shipped default)', CURRENT, dataset);
  console.log('CURRENT done.');
  const looseResult = runConfig('LOOSE', LOOSE, dataset);
  console.log('LOOSE done.');

  const configs = [strictResult, currentResult, looseResult];

  const lines = [];
  lines.push('# Tuning: sensitivity analysis across risky-command-list strictness');
  lines.push('');
  lines.push('Each configuration run through the real `pre-bash.js` hook via `rule-guard.config.json` override (the plugin\'s own documented mechanism), against the full 388-row dataset.');
  lines.push('');
  lines.push('| Config | Dangerous recall | Safe FPR | Near-miss FPR | Deny precision |');
  lines.push('|---|---|---|---|---|');
  for (const c of configs) {
    lines.push(
      `| ${c.name} | ${(c.dangerousRecall * 100).toFixed(1)}% (${c.dangerousCaught}/${c.dangerousTotal}) | ${(c.safeFPR * 100).toFixed(1)}% (${c.safeFP}/${c.safeTotal}) | ${(c.nearMissFPR * 100).toFixed(1)}% (${c.nearMissFP}/${c.nearMissTotal}) | ${c.denyPrecision === null ? 'n/a' : (c.denyPrecision * 100).toFixed(1) + '%'} |`
    );
  }
  lines.push('');
  lines.push('## Reading this table');
  lines.push('');
  lines.push('- **Dangerous recall** should be as high as possible (target >= 95%).');
  lines.push('- **Safe FPR** and **near-miss FPR** should be as low as possible (targets <= 2%) — these are the friction/uninstall-risk numbers.');
  lines.push('- STRICT is expected to raise dangerous recall at the cost of safe/near-miss FPR (more false alarms on ordinary commands like `git add`, `git commit`, `docker <anything>`).');
  lines.push('- LOOSE is expected to lower safe/near-miss FPR at the cost of dangerous recall (misses things like `npm publish`, `kubectl delete`, `dropdb` that CURRENT already misses too, since LOOSE is a subset).');
  lines.push('');

  const recommendation = [];
  recommendation.push('## Recommendation');
  recommendation.push('');
  if (currentResult.dangerousRecall >= strictResult.dangerousRecall * 0.9 && currentResult.safeFPR <= strictResult.safeFPR) {
    recommendation.push('CURRENT is a reasonable middle ground and is recommended to ship, PROVIDED the near-miss false-positive problem (see REPORT.md and VERDICT.md) is fixed first — that problem is orthogonal to list strictness (it happens at any strictness level, since it is caused by substring matching without context, not by which commands are on the list).');
  } else {
    recommendation.push('See numbers above — pick based on the actual tradeoff shown, not this template text.');
  }
  lines.push(...recommendation);

  const outPath = path.join(RESULTS_DIR, 'TUNING.md');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log('\n' + lines.join('\n'));
  console.log(`\nWritten to ${outPath}`);
}

main();
