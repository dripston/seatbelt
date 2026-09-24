#!/usr/bin/env node
'use strict';

// Adherence harness: the only eval that matters for seatbelt v2. Every
// prior eval (see archive/enforcement) measured command classification,
// a product that no longer exists. This measures the one claim v2 makes:
// re-injected rules get followed at context depth where they'd otherwise
// decay.
//
// Method: create a headless session (fixed --session-id) inside a test
// project with a CLAUDE.md containing 3 mechanically-checkable rules.
// Pad the transcript with realistic, topically-unrelated work turns via
// `claude -p --resume`. At each depth checkpoint, issue a probe prompt
// per rule and check the response text against that rule's `check()`.
// Run the whole sequence twice: once with the seatbelt plugin enabled,
// once disabled (`claude plugin disable/enable seatbelt`).
//
// Cost/time note: each padding turn costs real API usage and ~10-90s of
// wall time. This is run deliberately, not in CI, and not on every
// commit.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { RULES } = require('./rules');
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
  // Windows cmd.exe quoting: wrap in double quotes, escape embedded
  // double quotes by doubling them. Sufficient for the plain-text
  // prompts and UUIDs this harness passes (no embedded % or ^).
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
// spanning multiple checkpoints within the same condition. Passing this
// as a mutable object (rather than re-deriving "started?" from a
// locally-scoped lastResult) is what fixes a real bug found while
// running this for real: re-calling runPaddingUntil per checkpoint with
// a fresh local lastResult=null wrongly re-issued --session-id on a
// session that already existed past checkpoint 1, which Claude Code
// correctly rejects ("Session ID ... is already in use").
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

function probe(sessionId, cwd, rule) {
  const result = claudeCall(
    ['-p', rule.probePrompt, '--resume', sessionId, '--output-format', 'json'],
    cwd
  );
  const responseText = result.result || '';
  const adhered = rule.check(responseText);
  return { adhered, responseText, tokensAtProbe: estimatedDepthTokens(result) };
}

function setPluginEnabled(enabled) {
  try {
    execSync(`claude.cmd plugin ${enabled ? 'enable' : 'disable'} seatbelt`, { encoding: 'utf8' });
  } catch (err) {
    // "already enabled"/"already disabled" is a no-op we want to ignore;
    // anything else should surface.
    const output = (err.stdout || '') + (err.stderr || '');
    if (!/already (enabled|disabled)/i.test(output)) throw err;
  }
}

function runCondition(conditionLabel, seatbeltEnabled, log) {
  setPluginEnabled(seatbeltEnabled);
  const cwd = mkTestProject();
  const sessionId = crypto.randomUUID();
  const paddingIndexRef = { i: 0 };
  const sessionState = { started: false, lastTokens: 0 };
  const rows = [];

  log(`\n=== Condition: ${conditionLabel} (seatbelt ${seatbeltEnabled ? 'enabled' : 'disabled'}) ===`);
  log(`Test project: ${cwd}`);
  log(`Session: ${sessionId}`);

  for (const checkpoint of CHECKPOINTS) {
    log(`\n-- Checkpoint: ${checkpoint} tokens --`);
    const actualDepth = runPaddingUntil(sessionId, cwd, checkpoint, log, paddingIndexRef, sessionState);

    for (const rule of RULES) {
      const { adhered, responseText, tokensAtProbe } = probe(sessionId, cwd, rule);
      log(`  [${rule.id}] adhered=${adhered} (probed at ~${tokensAtProbe} tokens)`);
      const row = {
        condition: conditionLabel,
        seatbeltEnabled,
        checkpoint,
        actualDepthAtPadding: actualDepth,
        tokensAtProbe,
        ruleId: rule.id,
        adhered,
        responseText,
      };
      rows.push(row);
      fs.appendFileSync(RAW_OUTPUT_PATH, JSON.stringify(row) + '\n');
    }
  }

  return rows;
}

function main() {
  fs.mkdirSync(path.dirname(RAW_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(RAW_OUTPUT_PATH, ''); // fresh file each run
  const log = (msg) => process.stdout.write(msg + '\n');

  log('seatbelt adherence harness starting.');
  log(`Checkpoints: ${CHECKPOINTS.join(', ')}`);
  log(`Rules: ${RULES.map((r) => r.id).join(', ')}`);

  const disabledRows = runCondition('seatbelt-disabled', false, log);
  const enabledRows = runCondition('seatbelt-enabled', true, log);

  // Restore to enabled at the end (the normal installed state).
  setPluginEnabled(true);

  log('\nDone. Raw rows written to ' + RAW_OUTPUT_PATH);
  log(`Total rows: ${disabledRows.length + enabledRows.length}`);
}

if (require.main === module) {
  main();
}

module.exports = { CHECKPOINTS, mkTestProject, runCondition };
