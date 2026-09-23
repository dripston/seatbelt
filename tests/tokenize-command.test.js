'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifySegment,
  stripComment,
  stripRedirections,
  stripLeadingAssignments,
  extractHeadCommand,
  splitPipes,
} = require('../scripts/lib/tokenize-command');

// --- stripComment ---

test('stripComment removes a trailing unquoted comment', () => {
  assert.equal(stripComment('echo hi # rm -rf /').trim(), 'echo hi');
});

test('stripComment leaves a # inside quotes untouched', () => {
  assert.equal(stripComment('echo "price is #5"'), 'echo "price is #5"');
});

test('stripComment handles a comment-only line', () => {
  assert.equal(stripComment('# git push later').trim(), '');
});

// --- stripRedirections ---

test('stripRedirections removes a simple output redirect target', () => {
  const result = stripRedirections('echo hi > notes.md');
  assert.ok(!result.includes('notes.md'));
});

test('stripRedirections removes an append redirect target', () => {
  const result = stripRedirections('echo "git push" >> notes.md');
  assert.ok(!result.includes('notes.md'));
});

test('stripRedirections removes a quoted redirect target', () => {
  const result = stripRedirections('echo hi > "my notes.md"');
  assert.ok(!result.includes('my notes.md'));
});

// --- stripLeadingAssignments ---

test('stripLeadingAssignments extracts a single env var prefix', () => {
  const { assignments, rest } = stripLeadingAssignments('FOO=bar git push');
  assert.equal(assignments, 'FOO=bar ');
  assert.equal(rest, 'git push');
});

test('stripLeadingAssignments extracts multiple env var prefixes', () => {
  const { assignments, rest } = stripLeadingAssignments('DEBUG=1 VERBOSE=1 git push --force');
  assert.equal(assignments, 'DEBUG=1 VERBOSE=1 ');
  assert.equal(rest, 'git push --force');
});

test('stripLeadingAssignments returns empty assignments when none present', () => {
  const { assignments, rest } = stripLeadingAssignments('git push');
  assert.equal(assignments, '');
  assert.equal(rest, 'git push');
});

// --- extractHeadCommand ---

test('extractHeadCommand finds a simple command', () => {
  assert.equal(extractHeadCommand('git push origin main').head, 'git');
});

test('extractHeadCommand strips a "sudo" wrapper', () => {
  assert.equal(extractHeadCommand('sudo rm -rf /').head, 'rm');
});

test('extractHeadCommand strips a "time" wrapper', () => {
  assert.equal(extractHeadCommand('time git push').head, 'git');
});

test('extractHeadCommand strips an absolute path prefix', () => {
  assert.equal(extractHeadCommand('/usr/bin/git push').head, 'git');
});

test('extractHeadCommand strips a leading backslash (alias bypass)', () => {
  assert.equal(extractHeadCommand('\\git push').head, 'git');
});

// --- splitPipes ---

test('splitPipes splits on unquoted pipe', () => {
  const parts = splitPipes('echo "git push" | bash');
  assert.equal(parts.length, 2);
  assert.equal(parts[1], 'bash');
});

test('splitPipes does not split on a pipe inside quotes', () => {
  const parts = splitPipes('echo "a | b"');
  assert.equal(parts.length, 1);
});

// --- classifySegment: the main integration surface ---

test('classifySegment: grep with risky text in argument is read-only, arg excluded from matching', () => {
  const result = classifySegment('grep "git push" src/');
  assert.equal(result.isReadOnly, true);
  assert.ok(!result.textForMatching.includes('git push'));
});

test('classifySegment: echo with risky text in argument is read-only, arg excluded', () => {
  const result = classifySegment('echo "never run git push --force"');
  assert.equal(result.isReadOnly, true);
  assert.ok(!result.textForMatching.includes('git push'));
});

test('classifySegment: a real git push command is NOT read-only, full text retained', () => {
  const result = classifySegment('git push origin main');
  assert.equal(result.isReadOnly, false);
  assert.ok(result.textForMatching.includes('push'));
});

test('classifySegment: comment-only content is excluded entirely', () => {
  const result = classifySegment('# git push later once tests pass');
  assert.ok(!result.textForMatching.includes('git push'));
});

test('classifySegment: trailing comment after a real command is stripped, command text remains', () => {
  const result = classifySegment('npm test # remember: never git push before this passes');
  assert.ok(!result.textForMatching.includes('git push'));
  assert.ok(result.textForMatching.includes('npm'));
});

test('classifySegment: find without -delete/-exec is read-only', () => {
  const result = classifySegment('find . -name "*deploy*"');
  assert.equal(result.isReadOnly, true);
});

test('classifySegment: find WITH -delete is NOT read-only', () => {
  const result = classifySegment('find . -name "*.tmp" -delete');
  assert.equal(result.isReadOnly, false);
});

test('classifySegment: sed without -i is read-only', () => {
  const result = classifySegment('sed -n "1,10p" deploy.sh');
  assert.equal(result.isReadOnly, true);
});

test('classifySegment: sed WITH -i is NOT read-only', () => {
  const result = classifySegment('sed -i "s/foo/bar/" deploy.sh');
  assert.equal(result.isReadOnly, false);
});

test('classifySegment: eval is an evaluator, full text retained even with quotes', () => {
  const result = classifySegment('eval "git push origin main"');
  assert.equal(result.isEvaluator, true);
  assert.ok(result.textForMatching.includes('push'));
});

test('classifySegment: echo piped into bash is an evaluator via the pipe stage', () => {
  const result = classifySegment('echo "git push origin main" | bash');
  assert.equal(result.isEvaluator, true);
  assert.ok(result.textForMatching.includes('push'));
});

test('classifySegment: sh -c wrapping a risky command is an evaluator', () => {
  const result = classifySegment('sh -c "git push origin main"');
  assert.equal(result.isEvaluator, true);
});

test('classifySegment: redirection target containing risky text is inert', () => {
  const result = classifySegment('echo "git push" >> notes.md');
  assert.ok(!result.textForMatching.includes('notes.md'));
});

test('classifySegment: env-var-prefixed real command retains assignment + command', () => {
  const result = classifySegment('GIT_TERMINAL_PROMPT=0 git push');
  assert.equal(result.isReadOnly, false);
  assert.ok(result.textForMatching.includes('push'));
});

test('classifySegment: env-var-prefixed grep is still read-only', () => {
  const result = classifySegment('FOO=bar grep "git push" .');
  assert.equal(result.isReadOnly, true);
});

test('classifySegment: man page lookup is read-only', () => {
  const result = classifySegment('man git-push');
  assert.equal(result.isReadOnly, true);
});

test('classifySegment: git --help style is read-only via echo/man/help allowlist behavior on head "git"', () => {
  // "git" itself is not in READ_ONLY_HEADS (git push/reset/etc are real
  // invocations most of the time), so "git push --help" is NOT
  // classified read-only by this heuristic alone — this documents that
  // limitation rather than asserting a false capability.
  const result = classifySegment('git push --help');
  assert.equal(result.isReadOnly, false);
});

test('classifySegment: touch with a risky-sounding filename retains only head (touch is not in matching risk list anyway)', () => {
  const result = classifySegment('touch "rm -rf"');
  // touch is not in READ_ONLY_HEADS, so this is NOT specially excluded —
  // documents current scope: filename-coincidence cases outside the
  // read-only allowlist still rely on the risky-pattern regex itself
  // being specific enough not to false-positive (a "rm -rf" filename
  // argument won't match "rm -rf" as a command since there's no rm/-rf
  // token structure the risky regex requires... but this heuristic layer
  // itself does not special-case it). Asserting current actual behavior.
  assert.equal(result.isReadOnly, false);
});
