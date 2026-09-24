#!/usr/bin/env node
'use strict';

// Adherence harness v2 — rebuilt after the first run's rule set measured
// nothing (2 of 3 rules held 100% regardless of seatbelt, one failed 0%
// regardless of seatbelt; see evals/adherence/RESULTS.md for the full
// post-mortem). This version uses 4 arbitrary rules with no natural pull
// either way (rules.js), verified to hold at ~45k-token depth (turn one)
// before this run, and issues multiple generic probes per checkpoint
// (probes.js) so a single miss isn't noise — each probe's response is
// checked against all 4 rules at once, since the rules apply to any
// response regardless of topic.
//
// Method: same as before — a headless session (`claude -p`, then
// `--resume`), padded to depth checkpoints, run twice (seatbelt-disabled,
// seatbelt-enabled), same prompts and same order in both arms.
//
// Cost/time note: each padding turn costs real API usage and ~10-90s of
// wall time; this run issues 4 probes per checkpoint instead of 1 (one
// per rule as before is now one per PROBE, all 4 rules checked against
// each), so total cost/time is roughly proportional. Run deliberately,
// not in CI.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { RULES } = require('./rules');
const { PROBES } = require('./probes');
const { paddingPrompt } = require('./padding-prompts');

const CHECKPOINTS = [25000, 50000, 100000, 150000, 200000];
const RAW_OUTPUT_PATH = path.join(__dirname, '..', 'results', 'adherence-raw.jsonl');

const CLAUDE_MD_CONTENT = [
  '<!-- rule-guard:critical -->',
  ...RULES.map((r) => `- ${r.ruleText}`),
  '<!-- /rule-guard:critical -->',
  '',
].join('\n');

function mkTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-adherence-run-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), CLAUDE_MD_CONTENT);
  return dir;
}

function cmdQuote(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

function claudeCall(args, cwd) {
  const commandLine = ['claude.cmd', ...args.map(cmdQuote)].join(' ');
  const raw = execSync(commandLine, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  return JSON.parse(raw);
}

function estimatedDepthTokens(result) {
  const u = result.usage || {};
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

// sessionState tracks whether --session-id (first turn ever) or --resume
// (every turn after) is correct, and the last known depth, across calls
// spanning multiple checkpoints within the same condition. A real bug
// found in the first run: re-deriving "started?" from a locally-scoped
// variable reset on every call wrongly re-issued --session-id on an
// already-started session past the first checkpoint.
function runPaddingUntil(sessionId, cwd, targetTokens, log, paddingIndexRef, sessionState) {
  let attempts = 0;
  const MAX_ATTEMPTS = 12; // safety valve: never loop forever if growth stalls
  while (sessionState.lastTokens < targetTokens && attempts < MAX_ATTEMPTS) {
    const prompt = paddingPrompt(paddingIndexRef.i++);
    const sessionFlag = sessionState.started ? ['--resume', sessionId] : ['--session-id', sessionId];
    const started = Date.now();
    const result = claudeCall(['-p', prompt, ...sessionFlag, '--output-format', 'json'], cwd);
    const elapsedMs = Date.now() - started;
    sessionState.started = true;
    sessionState.lastTokens = estimatedDepthTokens(result);
    log(`  padding turn: ${sessionState.lastTokens} tokens (target ${targetTokens}), ${elapsedMs}ms, cost $${(result.total_cost_usd || 0).toFixed(4)}`);
    attempts++;
  }
  return sessionState.lastTokens;
}

// Issues one probe and checks its single response against every rule.
// Rules that return null (not applicable to this response, e.g.
// tmp-prefix-vars on a prose-only response) are recorded as
// applicable=false and excluded from adherence-rate math, not counted
// as either a pass or a fail.
function probeAllRules(sessionId, cwd, probeText) {
  const result = claudeCall(['-p', probeText, '--resume', sessionId, '--output-format', 'json'], cwd);
  const responseText = result.result || '';
  const tokensAtProbe = estimatedDepthTokens(result);
  const perRule = RULES.map((rule) => {
    const verdict = rule.check(responseText);
    return { ruleId: rule.id, applicable: verdict !== null, adhered: verdict === true };
  });
  return { responseText, tokensAtProbe, perRule };
}

function setPluginEnabled(enabled) {
  try {
    execSync(`claude.cmd plugin ${enabled ? 'enable' : 'disable'} seatbelt`, { encoding: 'utf8' });
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    if (!/already (enabled|disabled)/i.test(output)) throw err;
  }
}

// Reads whatever rows already exist for a condition (e.g. from a prior
// run interrupted by a rate limit) so a resumed run can skip completed
// checkpoints/probes instead of re-spending API calls and re-appending
// duplicate rows. Returns { doneCheckpoints: Set<number>, cwd, sessionId,
// sessionState } or null if nothing usable is on disk for this condition.
function loadResumeState(conditionLabel) {
  if (!fs.existsSync(RAW_OUTPUT_PATH)) return null;
  const lines = fs.readFileSync(RAW_OUTPUT_PATH, 'utf8').trim();
  if (!lines) return null;
  const rows = lines.split('\n').map((l) => JSON.parse(l));
  const conditionRows = rows.filter((r) => r.condition === conditionLabel);
  if (conditionRows.length === 0) return null;

  const byCheckpoint = new Map();
  for (const r of conditionRows) {
    if (!byCheckpoint.has(r.checkpoint)) byCheckpoint.set(r.checkpoint, new Set());
    byCheckpoint.get(r.checkpoint).add(r.probeIndex);
  }
  const doneCheckpoints = new Set();
  for (const cp of CHECKPOINTS) {
    const probesDone = byCheckpoint.get(cp);
    if (probesDone && probesDone.size === PROBES.length) doneCheckpoints.add(cp);
  }

  // Session/cwd are the same across all rows for a condition (one
  // session per condition) - but rows don't carry them directly, so
  // this relies on the log file, not the JSONL, for those two fields.
  // Callers pass sessionId/cwd in explicitly when resuming; this
  // function only tells the caller which checkpoints to skip and what
  // the last known depth was.
  const lastRow = conditionRows[conditionRows.length - 1];
  return { doneCheckpoints, lastKnownDepth: lastRow.actualDepthAtPadding };
}

function runCondition(conditionLabel, seatbeltEnabled, log, resumeInfo) {
  setPluginEnabled(seatbeltEnabled);
  const cwd = (resumeInfo && resumeInfo.cwd) || mkTestProject();
  const sessionId = (resumeInfo && resumeInfo.sessionId) || crypto.randomUUID();
  const paddingIndexRef = { i: 0 };
  const sessionState = resumeInfo
    ? { started: true, lastTokens: resumeInfo.lastKnownDepth }
    : { started: false, lastTokens: 0 };
  const doneCheckpoints = (resumeInfo && resumeInfo.doneCheckpoints) || new Set();
  const rows = [];

  log(`\n=== Condition: ${conditionLabel} (seatbelt ${seatbeltEnabled ? 'enabled' : 'disabled'}) ===`);
  log(`Test project: ${cwd}`);
  log(`Session: ${sessionId}`);
  if (resumeInfo) log(`Resuming: skipping already-complete checkpoints [${[...doneCheckpoints].join(', ')}]`);

  for (const checkpoint of CHECKPOINTS) {
    if (doneCheckpoints.has(checkpoint)) {
      log(`\n-- Checkpoint: ${checkpoint} tokens (already complete, skipping) --`);
      continue;
    }
    log(`\n-- Checkpoint: ${checkpoint} tokens --`);
    const actualDepth = runPaddingUntil(sessionId, cwd, checkpoint, log, paddingIndexRef, sessionState);

    for (let probeIndex = 0; probeIndex < PROBES.length; probeIndex++) {
      const probeText = PROBES[probeIndex];
      const { responseText, tokensAtProbe, perRule } = probeAllRules(sessionId, cwd, probeText);
      log(`  probe ${probeIndex} (~${tokensAtProbe} tokens): ${perRule.map((r) => `${r.ruleId}=${r.applicable ? r.adhered : 'n/a'}`).join(' ')}`);
      const row = {
        condition: conditionLabel,
        seatbeltEnabled,
        checkpoint,
        actualDepthAtPadding: actualDepth,
        probeIndex,
        probeText,
        tokensAtProbe,
        perRule,
        responseText,
      };
      rows.push(row);
      fs.appendFileSync(RAW_OUTPUT_PATH, JSON.stringify(row) + '\n');
    }
  }

  return rows;
}

function main() {
  const args = process.argv.slice(2);
  const resumeFlagIndex = args.indexOf('--resume-condition');
  const resumeConditionArg = resumeFlagIndex >= 0 ? args[resumeFlagIndex + 1] : null;
  const resumeSessionIndex = args.indexOf('--resume-session');
  const resumeSessionArg = resumeSessionIndex >= 0 ? args[resumeSessionIndex + 1] : null;
  const resumeCwdIndex = args.indexOf('--resume-cwd');
  const resumeCwdArg = resumeCwdIndex >= 0 ? args[resumeCwdIndex + 1] : null;

  fs.mkdirSync(path.dirname(RAW_OUTPUT_PATH), { recursive: true });
  const log = (msg) => process.stdout.write(msg + '\n');

  if (resumeConditionArg) {
    // Resuming a prior interrupted run (e.g. hit a rate limit mid-condition):
    // do NOT truncate the existing raw output, and only run the named
    // condition plus whatever condition(s) come after it in sequence.
    log(`seatbelt adherence harness v2 RESUMING from condition "${resumeConditionArg}".`);
    const conditions = [
      ['seatbelt-disabled', false],
      ['seatbelt-enabled', true],
    ];
    const startIndex = conditions.findIndex(([label]) => label === resumeConditionArg);
    if (startIndex === -1) {
      log(`Unknown condition "${resumeConditionArg}". Expected one of: ${conditions.map((c) => c[0]).join(', ')}`);
      process.exit(1);
    }
    const resumeInfoForFirst = loadResumeState(resumeConditionArg);
    if (!resumeInfoForFirst) {
      log(`No existing rows found for condition "${resumeConditionArg}" - nothing to resume, run without --resume-condition instead.`);
      process.exit(1);
    }
    if (!resumeSessionArg || !resumeCwdArg) {
      log('Resuming requires --resume-session <uuid> --resume-cwd <path> (read from the interrupted run\'s log file).');
      process.exit(1);
    }
    resumeInfoForFirst.sessionId = resumeSessionArg;
    resumeInfoForFirst.cwd = resumeCwdArg;

    const allRows = [];
    for (let i = startIndex; i < conditions.length; i++) {
      const [label, enabled] = conditions[i];
      const info = i === startIndex ? resumeInfoForFirst : null;
      allRows.push(...runCondition(label, enabled, log, info));
    }
    setPluginEnabled(true);
    log('\nDone (resumed run). Total new rows this invocation: ' + allRows.length);
    return;
  }

  fs.writeFileSync(RAW_OUTPUT_PATH, ''); // fresh file for a normal (non-resume) run

  log('seatbelt adherence harness v2 starting.');
  log(`Checkpoints: ${CHECKPOINTS.join(', ')}`);
  log(`Rules: ${RULES.map((r) => r.id).join(', ')}`);
  log(`Probes per checkpoint: ${PROBES.length}`);

  const disabledRows = runCondition('seatbelt-disabled', false, log, null);
  const enabledRows = runCondition('seatbelt-enabled', true, log, null);

  setPluginEnabled(true); // restore normal installed state

  log('\nDone. Raw rows written to ' + RAW_OUTPUT_PATH);
  log(`Total rows: ${disabledRows.length + enabledRows.length}`);
}

if (require.main === module) {
  main();
}

module.exports = { CHECKPOINTS, mkTestProject, runCondition };
