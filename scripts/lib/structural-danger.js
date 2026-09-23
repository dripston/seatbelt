'use strict';

// Structural danger detection: recognizes the SHAPE of a destructive
// command (verb + target, destructive flag combinations, high-risk
// targets, inline destructive queries, publish/release shape) rather
// than enumerating specific tool names. Built after a holdout eval
// proved the tool-name-enumeration approach (scripts/risky-commands.js's
// original list) collapsed from 99.1% to 12.0% recall on tools it hadn't
// been shown — see evals/results/HOLDOUT_REPORT.md. Every signal here is
// a separate, independently-testable predicate so each can be measured
// and tuned on its own (see PROGRESS.md's per-signal firing table).
//
// Every predicate here operates on the REAL-INVOCATION text only — the
// caller is expected to have already run tokenize-command.js's
// classifySegment() and pass in textForMatching, so a destructive word
// sitting inside a comment, a quoted string, or a read-only command's
// argument never reaches these predicates in the first place.
//
// Default stance: every signal here maps to "ask", never "deny". A hard
// deny is reserved exclusively for a user's own guard-tagged rule
// (pre-bash.js's guardedRules path). This file never emits deny.

/**
 * Signal A: destructive verb + target.
 * A head command followed (anywhere after it) by a subcommand/argument
 * matching a destructive verb, with a real TARGET argument following it
 * (a resource name, path, or identifier — NOT a --help/-h flag, and NOT
 * nothing at all). Catches "flux delete kustomization x",
 * "doctl databases delete x", "rclone purge remote:x",
 * "influx bucket delete x", "git update-ref -d x" without knowing any of
 * those specific tools/binaries exist.
 *
 * Deliberately EXCLUDES "uninstall" and bare "remove"/"rm" of a named
 * PACKAGE (not a filesystem path) from firing here: "npm uninstall
 * lodash", "pip uninstall x -y" are extremely common, routine developer
 * actions (removing a dependency), not the kind of irreversible
 * infrastructure/data destruction this signal targets. Package
 * uninstalls are a fundamentally lower-risk action (reversible by
 * reinstalling) than deleting a cloud resource or a database. "rm" on an
 * actual filesystem path is still covered by the existing enumerated
 * "rm -rf" pattern in risky-commands.js, which requires the -r/-f flags
 * that make filesystem rm actually dangerous — a bare "rm file.txt" with
 * no recursive/force flag is a normal, low-risk, easily-undone-via-git
 * action and correctly falls through as allow here too.
 */
const DESTRUCTIVE_VERBS = [
  'delete', 'destroy', 'drop', 'purge', 'prune', 'wipe', 'flush',
  'erase', 'truncate', 'revoke', 'terminate', 'teardown',
];
const NON_TARGET_RE = /^(--help|-h|--version|-v|--dry-run)$/i;
const DESTRUCTIVE_VERB_RE = new RegExp(
  `\\b(${DESTRUCTIVE_VERBS.join('|')})\\b\\s+(?:-{1,2}[A-Za-z][\\w-]*(?:[= ]\\S+)?\\s*)*(\\S+)`,
  'i'
);

function matchesDestructiveVerbAndTarget(text) {
  if (typeof text !== 'string') return { matched: false };
  const m = DESTRUCTIVE_VERB_RE.exec(text);
  if (!m) return { matched: false };
  const target = m[2];
  if (!target || NON_TARGET_RE.test(target)) return { matched: false };
  return { matched: true, verb: m[1].toLowerCase(), signal: 'A' };
}

/**
 * Signal B: destructive flags, any binary.
 * A destructive-shaped flag combination, independent of which verb or
 * binary carries it: --force/-f paired with a destructive verb anywhere
 * in the same text, --recursive/-r paired with delete/rm, an explicit
 * root-bypass flag, --hard, --all paired with delete, a kill signal
 * (-9) with a process-signaling command, or a sync tool's --delete flag.
 */
const KILL_LIKE_HEADS = new Set(['kill', 'pkill', 'killall']);

function matchesDestructiveFlags(text, headCommand) {
  if (typeof text !== 'string') return { matched: false };

  if (/--no-preserve-root\b/i.test(text)) return { matched: true, signal: 'B', reason: '--no-preserve-root' };
  if (/\bgit\b.*?\breset\b.*?--hard\b/is.test(text)) return { matched: true, signal: 'B', reason: '--hard reset' };
  if (/\bprune\b/i.test(text) && /\b(git|npm|docker|helm)\b/i.test(text)) {
    return { matched: true, signal: 'B', reason: 'prune' };
  }
  if (headCommand && KILL_LIKE_HEADS.has(headCommand) && /-9\b|SIGKILL\b/i.test(text)) {
    return { matched: true, signal: 'B', reason: 'kill -9 / SIGKILL' };
  }
  // --recursive/-r paired with delete/rm anywhere in the text (order-independent).
  // Excludes "git rm ... --cached": that untracks files from git's index
  // without touching them on disk at all — one of the most common, safe
  // git operations, and it inherently contains both "-r" and "rm" as
  // ordinary git syntax, not a recursive-delete flag combination.
  if (
    /(--recursive\b|(?<!\w)-[a-zA-Z]*r[a-zA-Z]*\b)/i.test(text) &&
    /\b(delete|rm|purge)\b/i.test(text) &&
    !(/\bgit\b.*?\brm\b/is.test(text) && /--cached\b/i.test(text))
  ) {
    return { matched: true, signal: 'B', reason: '--recursive/-r + delete-like verb' };
  }
  // --force/-f paired with a destructive verb anywhere in the text
  if (/(--force\b|(?<!\w)-[a-zA-Z]*f[a-zA-Z]*\b)/i.test(text) && DESTRUCTIVE_VERB_RE.test(text)) {
    return { matched: true, signal: 'B', reason: '--force/-f + destructive verb' };
  }
  // --all paired with delete
  if (/--all\b/i.test(text) && /\bdelete\b/i.test(text)) {
    return { matched: true, signal: 'B', reason: '--all + delete' };
  }
  // a sync tool's --delete flag (rsync --delete, etc.) mirrors/wipes the destination
  if (/--delete\b/i.test(text) && /\brsync\b/i.test(text)) {
    return { matched: true, signal: 'B', reason: 'rsync --delete' };
  }
  return { matched: false };
}

/**
 * Signal C: high-risk targets.
 * A raw device path (/dev/*), a broad system path (/, /etc, /var, /usr,
 * /boot) as a standalone argument, a remote object-store URI
 * (s3://, gs://, oci://, azure://, a rclone-style remote:path), or an
 * argument containing prod/production/live — on any command that is not
 * read-only (the caller has already excluded read-only-command
 * arguments via classifySegment before this runs, so reaching this point
 * at all means the head command was NOT classified read-only).
 */
const DEVICE_PATH_RE = /\/dev\/(sd|nvme|xvd|hd)\w*/i;
const SYSTEM_PATH_RE = /(^|[\s"'])(\/|\/etc|\/var|\/usr|\/boot)(?=[\s"'/]|$)/;
const PROD_TARGET_RE = /\b(prod|production|live)[\w-]*\b/i;

// Action-indicating words that make a "prod/production/live" mention, or
// a cloud-storage URI, actually relevant to risk — without one of these
// present, "production" is just as likely to be a harmless env var value,
// branch name, or build-script name (e.g. "export NODE_ENV=production")
// as a real operation on a production resource, and an s3://... URI is
// just as likely to be the target of a harmless `ls`/`cat`/`describe` as
// a destructive `rm`/`delete`. Deliberately broader than the
// DESTRUCTIVE_VERBS list (includes non-destructive-but-impactful verbs
// like stop/restart/apply/deploy) since a production TARGET makes even a
// normally-benign verb worth a confirmation.
const ACTION_INDICATOR_RE =
  /\b(delete|destroy|drop|purge|prune|wipe|flush|remove|rm|erase|truncate|revoke|terminate|kill|teardown|reset|stop|restart|disable|apply|deploy|push|migrate|rollback|scale|shutdown)\b/i;

// Explicitly read-only verbs that, when present, mean a cloud-object-store
// URI or a device/system path is very likely just being inspected, not
// acted on destructively — even though the head command itself (e.g. aws,
// gsutil) is not in the tokenizer's general READ_ONLY_HEADS allowlist
// (most of what those CLIs do IS destructive, so they can't be blanket
// allowlisted the way grep/cat can). This is a narrower, per-argument
// escape hatch specifically for signal C's URI/path checks.
const EXPLICIT_READONLY_VERB_RE = /\b(ls|list|cat|get|describe|view|show|status|head|info|inspect)\b/i;

function matchesHighRiskTarget(text) {
  if (typeof text !== 'string') return { matched: false };
  if (EXPLICIT_READONLY_VERB_RE.test(text)) return { matched: false };
  if (DEVICE_PATH_RE.test(text)) return { matched: true, signal: 'C', reason: 'raw device path' };
  if (SYSTEM_PATH_RE.test(text)) return { matched: true, signal: 'C', reason: 'broad system path' };
  // rclone-style "remote:path" needs a preceding destructive-shaped verb
  // to avoid firing on any URL-like or Windows-drive-like text; checked
  // alongside a destructive verb by the caller (see evaluateAll), but a
  // narrower direct check here for cloud object-store URIs is safe alone.
  if (/\b(s3|gs|oci|azure|abfss?):\/\/\S+/i.test(text)) {
    return { matched: true, signal: 'C', reason: 'cloud object-store URI' };
  }
  // "prod/production/live" alone is not enough — it's extremely common in
  // harmless contexts (env var values, branch names, build script names).
  // Only treat it as a high-risk TARGET when paired with an action word,
  // so "export NODE_ENV=production" (no action verb) correctly falls
  // through as allow, while "systemctl stop production-service" or
  // "doctl databases delete prod-cluster" still fires.
  if (PROD_TARGET_RE.test(text) && ACTION_INDICATOR_RE.test(text)) {
    return { matched: true, signal: 'C', reason: 'prod/production/live target with an action verb' };
  }
  return { matched: false };
}

/**
 * Signal D: inline destructive query execution.
 * Any binary invoked with -e/-c/--eval/--execute/--command whose argument
 * contains a destructive SQL/datastore keyword. Catches mongosh, cqlsh,
 * redis-cli, psql, mysql uniformly, without naming any of them.
 */
const DESTRUCTIVE_QUERY_KEYWORDS = [
  'DROP\\s+(DATABASE|TABLE|KEYSPACE|SCHEMA|INDEX)',
  'TRUNCATE\\s+(TABLE)?',
  'DELETE\\s+FROM',
  'FLUSHALL',
  'FLUSHDB',
  'dropDatabase',
  'dropCollection',
];
const DESTRUCTIVE_QUERY_RE = new RegExp(DESTRUCTIVE_QUERY_KEYWORDS.join('|'), 'i');
const INLINE_EXEC_FLAG_RE = /(^|\s)(-e|-c|--eval|--execute|--command)(\s|=)/;

function matchesInlineDestructiveQuery(text) {
  if (typeof text !== 'string') return { matched: false };
  if (!INLINE_EXEC_FLAG_RE.test(text)) return { matched: false };
  if (!DESTRUCTIVE_QUERY_RE.test(text)) return { matched: false };
  return { matched: true, signal: 'D', reason: 'inline exec flag + destructive query keyword' };
}

/**
 * Signal E: publish/release shape.
 * A binary whose subcommand is publish/push/upload/release AND which
 * takes a registry URL, a package file argument, or a
 * --source/--index-url/--registry-style flag. Catches poetry, dotnet
 * nuget, composer, helm, cargo, gem without naming them. Deliberately
 * requires BOTH the verb and a registry/package-shaped argument, so a
 * bare "push" (e.g. git push, already handled by signal A/existing guard
 * logic) doesn't double-fire here without a package/registry context.
 */
const RELEASE_VERB_RE = /\b(publish|upload|release)\b|\bpush\b/i;
// Registry-shaped argument: an explicit registry-style flag, a URI with a
// protocol, a known package-artifact file extension, a dist/ path, OR a
// bare container-registry hostname reference (e.g.
// "myregistry.example.com/myimage:latest" or "host:5000/name:tag") —
// real Docker/OCI syntax has no "://" prefix, just a dotted hostname
// (optionally with a port) followed by a repository path and an optional
// ":tag". Requires a dot or colon-port in the host part specifically so
// this doesn't match an ordinary relative path like "src/main.py".
const REGISTRY_ARG_RE =
  /--(source|index-url|registry)\b|\b\w+:\/\/\S+|\.(tgz|whl|gem|nupkg|tar\.gz|jar)\b|\bdist\/\S+|\b[\w-]+(\.[\w-]+)+(:\d+)?\/[\w./-]+(:[\w.-]+)?\b/i;

function matchesPublishShape(text) {
  if (typeof text !== 'string') return { matched: false };
  if (!RELEASE_VERB_RE.test(text)) return { matched: false };
  if (!REGISTRY_ARG_RE.test(text)) return { matched: false };
  return { matched: true, signal: 'E', reason: 'publish/push/upload/release verb + registry-shaped argument' };
}

/**
 * Signal F: irreducible list. Commands with no shared structural shape —
 * a bare word with no verb/flag/target pattern to generalize from. Kept
 * deliberately small; each entry documents why it resists structural
 * detection.
 *
 * - poweroff, halt, reboot, shutdown, init 0: bare single-word (or
 *   word + numeric-argument) commands with no destructive VERB in the
 *   sense signals A/B look for ("poweroff" is not "delete X" or
 *   "X --force") and no TARGET argument at all in the common case
 *   ("poweroff" takes no arguments) — there is no shape to generalize,
 *   only the specific word itself carries the risk.
 * - mkfs*, wipefs, dd, shred: operate on a device/file argument that
 *   looks identical in shape to any other file/device-taking command
 *   (there's nothing structurally different between "dd if=x of=y" and
 *   many harmless uses of dd for legitimate copying) — the risk is
 *   entirely in the verb identity itself, not a detectable pattern
 *   around it.
 */
const IRREDUCIBLE_HEADS = new Set([
  'poweroff', 'halt', 'reboot', 'shutdown', 'init',
  'mkfs', 'wipefs', 'dd', 'shred',
]);
/**
 * Checks the HEAD COMMAND specifically (not free-text search across the
 * whole string) against the irreducible list. This was originally a
 * free-text regex, which wrongly fired on any of these words appearing
 * inside a URL, filename, or comment (e.g. "curl .../wipefs-notes.md") —
 * the exact class of bug the tokenizer's classifySegment/headCommand
 * extraction exists to prevent. mkfs additionally checks for its dotted
 * variants (mkfs.ext4, mkfs.xfs, ...) since those are separate head
 * commands in practice. "init" only counts when followed by "0" (the
 * shutdown-runlevel meaning), since "init" alone is an extremely common,
 * harmless word (project scaffolding: "npm init", "git init", "terraform
 * init" — none of which should ever reach this check anyway since their
 * own head command is npm/git/terraform, not "init").
 */
function matchesIrreducible(text, headCommand) {
  if (typeof text !== 'string' || !headCommand) return { matched: false };
  if (headCommand === 'init') {
    if (/\binit\s+0\b/i.test(text)) return { matched: true, signal: 'F', reason: 'init 0' };
    return { matched: false };
  }
  if (headCommand === 'mkfs' || /^mkfs\.\w+$/i.test(headCommand)) {
    return { matched: true, signal: 'F', reason: 'mkfs' };
  }
  if (IRREDUCIBLE_HEADS.has(headCommand)) {
    return { matched: true, signal: 'F', reason: headCommand };
  }
  return { matched: false };
}

/**
 * Runs all signals in order, returning the first match (or null). Every
 * signal maps to "ask" — never "deny" — per the fix-pass's default-stance
 * rule (a hard deny is reserved for a user's own guard-tagged rule).
 */
function evaluateStructuralDanger(text, headCommand) {
  const checks = [
    () => matchesDestructiveVerbAndTarget(text),
    () => matchesDestructiveFlags(text, headCommand),
    () => matchesHighRiskTarget(text),
    () => matchesInlineDestructiveQuery(text),
    () => matchesPublishShape(text),
    () => matchesIrreducible(text, headCommand),
  ];
  for (const check of checks) {
    const result = check();
    if (result.matched) return result;
  }
  return null;
}

module.exports = {
  matchesDestructiveVerbAndTarget,
  matchesDestructiveFlags,
  matchesHighRiskTarget,
  matchesInlineDestructiveQuery,
  matchesPublishShape,
  matchesIrreducible,
  evaluateStructuralDanger,
  DESTRUCTIVE_VERBS,
  IRREDUCIBLE_HEADS,
};
