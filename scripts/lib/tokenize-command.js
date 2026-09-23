'use strict';

// Unicode whitespace characters that visually resemble a normal space and
// could be used (deliberately or accidentally) to break naive \s-based
// regex matching between two words, e.g. "git<NBSP>push". Normalized to
// a plain space (U+0020) before any pattern matching. Does not touch
// literal newlines/tabs, which are handled separately by the `s`
// (dotAll) flag on the risky-pattern regexes themselves.
const UNUSUAL_WHITESPACE_RE = /[   -    　﻿]/g;

/**
 * Replaces unusual/lookalike whitespace characters with a plain space.
 * Never throws; non-string input passes through unchanged.
 */
function normalizeWhitespace(text) {
  if (typeof text !== 'string') return text;
  return text.replace(UNUSUAL_WHITESPACE_RE, ' ');
}

// A lightweight, heuristic command-structure pass — NOT a full Bash parser.
// Its job is to separate "this text is a real command invocation" from
// "this text merely appears inside a command" (a quoted string argument, a
// comment, a redirection target, a read-only command's search text), so
// risky-pattern matching can be applied only to the parts that represent
// real intent to run something.
//
// Where this heuristic cannot decide confidently, it falls through to
// treating the segment as "needs full matching" (the existing behavior) —
// it fails toward asking, never toward silently allowing something the
// old, cruder matcher would have caught.

// Commands whose own output/purpose is to read, search, or display
// something — risky text appearing only in THEIR arguments (not as a
// chained/piped subsequent command) is inert, not an invocation.
const READ_ONLY_HEADS = new Set([
  'grep', 'rg', 'ag', 'ack',
  'cat', 'less', 'more', 'head', 'tail', 'bat',
  'man', 'tldr', 'help',
  'ls', 'find', // 'find' is read-only UNLESS it has -delete or -exec; handled specially below
  'wc', 'diff', 'file',
  'awk', 'sed', // 'sed' is read-only UNLESS it has -i (in-place edit); handled specially below
  'code', 'vim', 'vi', 'nvim', 'nano', 'subl', 'idea', 'open',
  'echo', 'printf', // inert UNLESS piped into a shell evaluator; handled in caller
  'history', 'fc',
  'jq', 'yq',
]);

// git subcommands that only read/display information — "git log --grep=x",
// "git show", "git diff", "git blame", "git help", "git status" etc. do
// not themselves perform any risky action, so risky-looking text in their
// arguments (a search pattern, a commit message being displayed) is
// inert. "git" itself is not in READ_ONLY_HEADS because most of its
// subcommands (push, reset, clean, branch -D, checkout -- .) are exactly
// what this tool exists to catch — this is a narrower, subcommand-level
// allowlist instead.
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'log', 'show', 'diff', 'blame', 'help', 'status', 'ls-files',
  'cat-file', 'rev-parse', 'describe', 'shortlog', 'reflog',
  'remote', // bare "git remote" / "git remote -v" is read-only; "git remote add/rm" mutate config but not code/history, out of this tool's risk scope
]);

/**
 * Returns the git subcommand from a "git ..." argument string (the part
 * after "git"), skipping global flags like --no-pager, -C <dir>.
 */
function extractGitSubcommand(argsAfterGit) {
  const tokens = argsAfterGit.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-C') {
      i += 2; // -C <path>
      continue;
    }
    if (t.startsWith('-')) {
      i += 1;
      continue;
    }
    return t;
  }
  return null;
}

// Commands that evaluate/execute a string as a NEW command — text inside
// their arguments (even quoted) must still be inspected, because it is
// about to become a real invocation.
const EVALUATOR_HEADS = new Set(['eval', 'xargs']);
// sh/bash/zsh -c "..." are handled specially since the evaluator-ness
// depends on the -c flag, not just the head command name.
const SHELL_INTERPRETER_HEADS = new Set(['sh', 'bash', 'zsh', 'ksh']);

/**
 * Splits a command into top-level pipe segments (` | `), respecting quotes,
 * so a pipeline's later segments (e.g. `... | bash`) are visible as
 * separate potential evaluators. This is intentionally simpler than
 * split-command.js's &&/;/| splitting — tokenize-command works one
 * &&/;-delimited segment at a time (the caller already split those) and
 * only needs pipe-awareness for the evaluator check.
 */
function splitPipes(segment) {
  const parts = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === '|' && !inSingle && !inDouble) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Strips a trailing unquoted `#` comment from a single-line segment.
 * Only handles the common case (# preceded by whitespace or start of
 * string, not inside quotes) — a heuristic, not full shell parsing.
 */
function stripComment(segment) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    const prev = segment[i - 1];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(prev))) {
      return segment.slice(0, i);
    }
  }
  return segment;
}

/**
 * Strips redirection targets (`> file`, `>> file`, `2> file`, `< file`)
 * from a segment. Redirection targets are data (a filename), not part of
 * the invoked command or its meaningful arguments. Heuristic: removes the
 * operator and the single following whitespace-delimited or quoted token.
 */
function stripRedirections(segment) {
  return segment.replace(/(\d*>>?|<)\s*("[^"]*"|'[^']*'|\S+)/g, ' ');
}

/**
 * Extracts leading env-var assignments (FOO=bar BAZ=qux cmd ...) and
 * returns { assignments, rest }.
 */
function stripLeadingAssignments(segment) {
  const trimmed = segment.trim();
  const assignRe = /^([A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)/;
  let rest = trimmed;
  let consumed = '';
  let match;
  while ((match = assignRe.exec(rest)) !== null) {
    consumed += match[1];
    rest = rest.slice(match[1].length);
  }
  return { assignments: consumed, rest };
}

/**
 * Extracts the "head command" — the first bare word after stripping
 * leading env-var assignments, common no-op wrapper prefixes (time,
 * nohup, watch -n N, timeout N, command, sudo), and backslash-escape or
 * absolute-path prefixes on the command name itself.
 */
function extractHeadCommand(rest) {
  let s = rest.trim();

  // Strip a handful of transparent wrapper prefixes that don't change
  // what's actually being run, so the real head command underneath is
  // still classified correctly.
  const wrapperPatterns = [
    /^time\s+/,
    /^nohup\s+/,
    /^watch\s+(?:-n\s*\d+\s+)?/,
    /^timeout\s+\d+\s+/,
    /^command\s+/,
    /^sudo\s+/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of wrapperPatterns) {
      if (re.test(s)) {
        s = s.replace(re, '');
        changed = true;
      }
    }
  }

  // Strip a leading backslash (bypasses aliases) or absolute path prefix
  // on the command name itself, e.g. "\git" -> "git", "/usr/bin/git" -> "git".
  const headMatch = /^(\\?)(?:[^\s]*\/)?([A-Za-z0-9_.\-]+)/.exec(s);
  if (!headMatch) return { head: null, argsStart: 0 };
  const head = headMatch[2].toLowerCase();
  const argsStart = headMatch.index + headMatch[0].length;
  return { head, argsStart };
}

/**
 * Classifies a single &&/;-delimited segment (as produced by
 * split-command.js) into a decision about how much of it should be
 * exposed to risky-pattern matching.
 *
 * Returns { textForMatching, headCommand, isReadOnly, isEvaluator }.
 * `textForMatching` is the substring of the segment that should actually
 * be checked against risky patterns — for a read-only head command with
 * no evaluator/pipe-to-shell involved, this excludes the arguments
 * (since they're just search/display text), leaving only the head
 * command itself (which won't match any risky pattern on its own).
 * For anything else, textForMatching is the full segment (after
 * stripping comments and redirection targets), preserving current
 * (safe-by-default) behavior.
 */
function classifySegment(rawSegment) {
  const noComment = stripComment(rawSegment);
  const noRedirect = stripRedirections(noComment);

  const pipeParts = splitPipes(noRedirect);
  // If any pipe stage is a shell evaluator (bash/sh/zsh, eval, xargs, or
  // literally "bash"/"sh" as a bare pipe target like `... | bash`), the
  // whole segment must still be fully inspected — piping into a shell
  // makes upstream quoted text into a real invocation.
  for (const stage of pipeParts) {
    const { rest } = stripLeadingAssignments(stage);
    const { head } = extractHeadCommand(rest);
    if (head && (EVALUATOR_HEADS.has(head) || SHELL_INTERPRETER_HEADS.has(head))) {
      return { textForMatching: noRedirect, headCommand: head, isReadOnly: false, isEvaluator: true };
    }
  }

  const { assignments, rest } = stripLeadingAssignments(noRedirect);
  const { head, argsStart } = extractHeadCommand(rest);

  if (!head) {
    return { textForMatching: noRedirect, headCommand: null, isReadOnly: false, isEvaluator: false };
  }

  // find/sed are conditionally read-only depending on flags.
  let effectivelyReadOnly = READ_ONLY_HEADS.has(head);
  if (head === 'find' && /-delete\b|-exec\b/.test(rest)) effectivelyReadOnly = false;
  if (head === 'sed' && /-i\b/.test(rest)) effectivelyReadOnly = false;

  // git is conditionally read-only depending on its subcommand (log,
  // show, diff, blame, help, status, etc. are read-only; push, reset,
  // clean, branch -D, checkout -- . are not — see GIT_READ_ONLY_SUBCOMMANDS).
  let gitSubcommandEnd = null;
  if (head === 'git') {
    const argsAfterGit = rest.slice(argsStart);
    const subcommand = extractGitSubcommand(argsAfterGit);
    if (subcommand && GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
      effectivelyReadOnly = true;
      // Expose "git <subcommand>" itself to matching (harmless), but not
      // whatever comes after it (the --grep search text, a displayed
      // commit message, etc.).
      const subcommandIdx = rest.indexOf(subcommand, argsStart);
      gitSubcommandEnd = subcommandIdx >= 0 ? subcommandIdx + subcommand.length : argsStart;
    }
  }

  if (effectivelyReadOnly) {
    // Only the head command portion (assignments + wrapper-stripped
    // command name, plus the git subcommand word itself if applicable)
    // is exposed to matching; the arguments (search patterns, filenames,
    // displayed text) are inert.
    const cutoff = gitSubcommandEnd !== null ? gitSubcommandEnd : argsStart;
    const headPortion = assignments + rest.slice(0, cutoff);
    return { textForMatching: headPortion, headCommand: head, isReadOnly: true, isEvaluator: false };
  }

  return { textForMatching: noRedirect, headCommand: head, isReadOnly: false, isEvaluator: false };
}

/**
 * Given quote-respecting segments (from split-command.js's splitCommand),
 * returns an array of strings — the text from each segment that should
 * actually be exposed to risky-pattern matching. This never removes a
 * segment entirely (even a fully-inert one is replaced by its harmless
 * head-command text, not dropped), preserving the caller's per-segment
 * iteration structure.
 */
function tokenizeForMatching(segments) {
  return segments.map((seg) => classifySegment(seg).textForMatching);
}

module.exports = {
  classifySegment,
  tokenizeForMatching,
  normalizeWhitespace,
  stripComment,
  stripRedirections,
  stripLeadingAssignments,
  extractHeadCommand,
  splitPipes,
  READ_ONLY_HEADS,
  EVALUATOR_HEADS,
  SHELL_INTERPRETER_HEADS,
};
