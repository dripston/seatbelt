#!/usr/bin/env node
'use strict';

// Phase 4: measure exactly where hook latency goes — process spawn/module
// load overhead vs. actual decide() execution — before attempting any
// optimization, per the fix-pass plan's explicit instruction.

const { execFileSync } = require('child_process');
const path = require('path');

const PRE_BASH = path.join(__dirname, '..', 'scripts', 'pre-bash.js');

// 1. In-process decide() timing (no process spawn at all).
const { decide } = require('../scripts/pre-bash');
const fs = require('fs');
const os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-test-'));

const N = 200;
let totalDecideMs = 0;
for (let i = 0; i < N; i++) {
  const start = process.hrtime.bigint();
  decide('git push origin main', dir);
  const end = process.hrtime.bigint();
  totalDecideMs += Number(end - start) / 1e6;
}
const avgDecideMs = totalDecideMs / N;

// 2. Full child-process invocation timing (spawn + module load + stdin + decide + stdout).
const childTimings = [];
for (let i = 0; i < N; i++) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: dir });
  const start = process.hrtime.bigint();
  execFileSync('node', [PRE_BASH], { input, encoding: 'utf8', timeout: 5000 });
  const end = process.hrtime.bigint();
  childTimings.push(Number(end - start) / 1e6);
}
childTimings.sort((a, b) => a - b);
const avgChildMs = childTimings.reduce((a, b) => a + b, 0) / N;
const p50Child = childTimings[Math.floor(N * 0.5)];
const p95Child = childTimings[Math.floor(N * 0.95)];

// 3. Bare "node -e" startup cost, no script logic at all (pure Node cold start).
const bareTimings = [];
for (let i = 0; i < N; i++) {
  const start = process.hrtime.bigint();
  execFileSync('node', ['-e', ''], { timeout: 5000 });
  const end = process.hrtime.bigint();
  bareTimings.push(Number(end - start) / 1e6);
}
bareTimings.sort((a, b) => a - b);
const avgBareMs = bareTimings.reduce((a, b) => a + b, 0) / N;
const p50Bare = bareTimings[Math.floor(N * 0.5)];
const p95Bare = bareTimings[Math.floor(N * 0.95)];

const attributedToScript = avgChildMs - avgBareMs;

const report = `# Latency breakdown (Phase 4)

N=${N} iterations each.

| Measurement | avg | p50 | p95 |
|---|---|---|---|
| In-process \`decide()\` only (no process spawn) | ${avgDecideMs.toFixed(3)}ms | — | — |
| Full \`node scripts/pre-bash.js\` child process (spawn + module load + stdin + decide + stdout) | ${avgChildMs.toFixed(2)}ms | ${p50Child.toFixed(2)}ms | ${p95Child.toFixed(2)}ms |
| Bare \`node -e ""\` (pure Node cold-start, no script logic at all) | ${avgBareMs.toFixed(2)}ms | ${p50Bare.toFixed(2)}ms | ${p95Bare.toFixed(2)}ms |

**Attributed to this script's own logic (module loading + decide()): ${attributedToScript.toFixed(2)}ms average** (full child process avg minus bare Node cold-start avg).

**Conclusion**: ${attributedToScript < avgChildMs * 0.15 ? "The overwhelming majority of latency is Node process cold-start overhead, NOT this script's logic. Even a bare, empty Node invocation costs nearly as much as the full hook." : "A meaningful share of latency comes from this script's own module loading or decide() logic, not just Node cold-start."}
`;

console.log(report);
require('fs').writeFileSync(path.join(__dirname, 'results', 'LATENCY_BREAKDOWN.md'), report);
