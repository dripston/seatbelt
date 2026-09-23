'use strict';

const { assessReversibility } = require('./assess-reversibility');

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
 * Signal A: destructive verb + target + high-consequence check.
 *
 * A head command followed (anywhere after it) by a subcommand/argument
 * matching a destructive verb, with a real TARGET argument following it
 * (a resource name, path, or identifier — NOT a --help/-h flag, and NOT
 * nothing at all) — AND the invocation must also score as
 * high-consequence on the reversibility axis (scripts/lib/assess-
 * reversibility.js). Catches "flux delete kustomization x",
 * "doctl databases delete --force x", "rclone purge remote:x",
 * "influx bucket delete x", "git update-ref -d x" without knowing any of
 * those specific tools/binaries exist.
 *
 * Verb vocabulary is organized by SEMANTIC FAMILY, not as a flat list of
 * words that happened to appear in a failing test case (see round-2 fix:
 * the original list only had "delete/destroy/drop/purge/..." because
 * those were the words in known failures — this expansion instead
 * enumerates the CONCEPTS a destructive command expresses, then lists
 * each family's real-world synonyms). A word not in a family is not
 * added, even if a specific test case would want it — if it doesn't fit
 * a concept, it doesn't belong here.
 *
 * "uninstall"/"remove"/"rm"/"kill" are included in the vocabulary again
 * (they were removed in round 1 to fix a false positive on "npm
 * uninstall lodash"), but round 1's fix is now handled correctly by the
 * reversibility gate instead of by removing the verb entirely: "npm
 * uninstall lodash" still doesn't fire, not because "uninstall" isn't a
 * destructive verb (it obviously can be), but because its TARGET is
 * project-local and re-derivable (round 1's fix, generalized). "brew
 * uninstall --force x" DOES fire, because --force suppresses
 * confirmation regardless of how re-derivable the target looks.
 */
const VERB_FAMILIES = {
  removal: ['remove', 'delete', 'rm', 'erase', 'drop', 'purge', 'discard', 'clear', 'clean', 'wipe', 'unlink', 'expunge', 'uninstall'],
  termination: ['kill', 'stop', 'terminate', 'halt', 'abort', 'cancel'],
  reduction: ['prune', 'trim', 'compact', 'vacuum', 'collect-garbage', 'gc', 'sweep'],
  revocation: ['revoke', 'disable', 'deactivate', 'lock', 'mask'],
  reset: ['reset', 'restore', 'rollback', 'revert', 'reinitialize', 'format'],
  separation: ['detach', 'unmount', 'eject', 'evict', 'drain', 'forget', 'deregister', 'unregister'],
  // Carried over from round 1, fit naturally into "removal"-adjacent but
  // kept distinct since they don't have a common single-word synonym set:
  destruction: ['destroy', 'truncate', 'flush', 'teardown'],
};
const DESTRUCTIVE_VERBS = Object.values(VERB_FAMILIES).flat();
// Escape regex metacharacters in verbs that contain them (collect-garbage
// has a hyphen, which is fine unescaped inside a word list, but kept
// explicit here for safety if a future family member needs it).
const VERB_ALTERNATION = DESTRUCTIVE_VERBS.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NON_TARGET_RE = /^(--help|-h|--version|-v|--dry-run)$/i;
const DESTRUCTIVE_VERB_RE = new RegExp(
  `\\b(${VERB_ALTERNATION})\\b\\s+(?:-{1,2}[A-Za-z][\\w-]*(?:[= ]\\S+)?\\s*)*(\\S+)`,
  'i'
);

function verbFamily(verb) {
  const lower = verb.toLowerCase();
  for (const [family, members] of Object.entries(VERB_FAMILIES)) {
    if (members.includes(lower)) return family;
  }
  return null;
}

/**
 * Splits a single identifier token on case transitions and separators,
 * so compound/fused verb forms become matchable words. Handles:
 *   - camelCase: "eraseDisk"          -> ["erase", "Disk"]
 *   - PascalCase: "RemoveItem"        -> ["Remove", "Item"]
 *   - kebab-case: "collect-garbage"   -> ["collect", "garbage"] (already
 *     handled by the hyphenated verb list itself, but this also covers
 *     unexpected kebab compounds)
 *   - snake_case: "reset_git_repo"    -> ["reset", "git", "repo"]
 *   - lowercase-fused: "deletelocalsnapshots" -> attempts a best-effort
 *     split by checking if the token STARTS WITH a known verb (see
 *     matchesFusedVerb below) — a fully fused lowercase run like this
 *     cannot be split generically without a dictionary, so that path is
 *     handled separately as a prefix check, not by this tokenizer.
 */
function splitMorphology(token) {
  if (typeof token !== 'string') return [];
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase / PascalCase boundary
    .replace(/[-_]/g, ' ') // kebab-case / snake_case
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Checks whether a single fused token (no separators, e.g.
 * "deletelocalsnapshots", "eraseDisk" after morphology splitting still
 * leaves "erase"+"Disk" as two words — this function additionally
 * handles the case where camelCase/separator splitting isn't present at
 * all and the verb is simply the PREFIX of a longer lowercase compound
 * word, which is a common naming style for tool-specific subcommands
 * (tmutil's "deletelocalsnapshots"). Returns the matched verb or null.
 */
function matchesFusedVerbPrefix(token) {
  if (typeof token !== 'string') return null;
  const lower = token.toLowerCase();
  for (const verb of DESTRUCTIVE_VERBS) {
    const plain = verb.replace('-', '');
    if (lower.startsWith(plain) && lower.length > plain.length) {
      // Require the fused word to plausibly continue as a real word (at
      // least 2 more characters), so we don't match a coincidental short
      // prefix (e.g. "resetting" starting with "reset" is fine and
      // intentional, but this guards against pathological 1-char tails).
      return verb;
    }
  }
  return null;
}

/**
 * PowerShell-style Verb-Noun cmdlets (Remove-Item, Clear-Disk,
 * Stop-Service, Reset-ComputerMachinePassword) fuse the destructive verb
 * into the HEAD COMMAND itself via a hyphen, e.g. headCommand extracted
 * as "remove-item" by tokenize-command.js. The Verb-Noun shape IS the
 * structural signal: split the head command on its FIRST hyphen and
 * check whether the first half is a known destructive verb.
 */
function matchesPowerShellVerbNoun(headCommand) {
  if (typeof headCommand !== 'string') return null;
  const hyphenIndex = headCommand.indexOf('-');
  if (hyphenIndex <= 0) return null;
  const verbPart = headCommand.slice(0, hyphenIndex).toLowerCase();
  if (DESTRUCTIVE_VERBS.includes(verbPart)) return verbPart;
  return null;
}

function matchesDestructiveVerbAndTarget(text, headCommand) {
  if (typeof text !== 'string') return { matched: false };

  let verb = null;
  let target = null;

  const m = DESTRUCTIVE_VERB_RE.exec(text);
  if (m) {
    verb = m[1].toLowerCase();
    target = m[2];
  } else {
    // Morphology fallback: no plain-word verb match. Try, in order:
    // (a) a PowerShell-style Verb-Noun head command,
    // (b) a camelCase/snake_case-fused verb inside ANY word of the
    //     command (the head command OR any argument/subcommand token —
    //     e.g. "diskutil eraseDisk" has the fused verb in the argument,
    //     not the head), or
    // (c) a fused lowercase prefix like "deletelocalsnapshots" in any word.
    const psVerb = matchesPowerShellVerbNoun(headCommand);
    if (psVerb) {
      verb = psVerb;
      // For PowerShell cmdlets, the "target" is whatever argument follows
      // the cmdlet name — any non-flag token counts, since the verb is
      // already fully expressed in the head command itself.
      const afterHead = text.slice(text.toLowerCase().indexOf(headCommand.toLowerCase()) + headCommand.length);
      const argMatch = /\s+(?:-{1,2}[A-Za-z][\w-]*(?:[= ]\S+)?\s*)*(\S+)/.exec(afterHead);
      target = argMatch ? argMatch[1] : null;
    } else {
      // Scan every whitespace-delimited word in the text (not just the
      // head command) for a morphology-split or fused-prefix verb match.
      const allWords = text.split(/\s+/).filter((w) => w.length > 0);
      for (const word of allWords) {
        const split = splitMorphology(word);
        const found = split.find((w) => DESTRUCTIVE_VERBS.includes(w.toLowerCase()));
        if (found) {
          verb = found.toLowerCase();
          target = 'implicit';
          break;
        }
        const fused = matchesFusedVerbPrefix(word);
        if (fused) {
          verb = fused;
          target = 'implicit';
          break;
        }
      }
    }
  }

  if (!verb) return { matched: false };
  if (target === null || (target !== 'implicit' && NON_TARGET_RE.test(target))) return { matched: false };

  // "uninstall" specifically is a package-management concept, unlike
  // "delete"/"drop"/"destroy" which apply broadly across infra/db/git
  // contexts too. When the verb is "uninstall" AND the target looks like
  // a bare package identifier (no path separator, no URI scheme, no
  // colon-delimited resource address) — e.g. "pinecone-client",
  // "left-pad", "lodash" — AND there is no --force/-f flag present (a
  // routine -y/--yes skip-confirmation flag doesn't change the fact that
  // reinstalling a package is trivial, but --force specifically means
  // "skip dependency safety checks too," a materially more dangerous
  // action — see the brew-uninstall-vs-npm-uninstall contrast case this
  // whole reversibility axis was built around) — treat it as
  // low-consequence. This was a real false positive found during round-2
  // testing ("pip uninstall pinecone-client -y"): a bare, pathless target
  // is itself evidence this is package management, not filesystem/infra
  // destruction. Scoped to "uninstall" alone so it does NOT weaken
  // "delete"/"drop"/"destroy" detection on bare identifiers like
  // "dropdb production" or "redis-cli FLUSHALL" elsewhere.
  const BARE_PACKAGE_IDENTIFIER_RE = /^[\w.@-]+$/;
  const FORCE_FLAG_RE = /--force\b|(?<!\w)-f\b/i;
  if (
    verb === 'uninstall' &&
    target !== 'implicit' &&
    BARE_PACKAGE_IDENTIFIER_RE.test(target) &&
    !FORCE_FLAG_RE.test(text)
  ) {
    return { matched: false };
  }

  // The reversibility gate: a destructive verb alone is not enough. See
  // scripts/lib/assess-reversibility.js — this is what lets "uninstall"
  // back into the vocabulary without "npm uninstall lodash" firing.
  const reversibility = assessReversibility(text, headCommand);
  if (!reversibility.highConsequence) return { matched: false };

  return {
    matched: true,
    verb,
    family: verbFamily(verb),
    signal: 'A',
    reason: `destructive verb (${verb}) + high-consequence target: ${reversibility.reasons.join(', ')}`,
  };
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
  // A bare --prune/--gc/--compact FLAG (not the verb form already covered
  // by signal A's reduction family) combined with a high-consequence
  // target, on any binary. Round-1 version hardcoded git/npm/docker/helm
  // as the only tools allowed to trigger this; removed in favor of the
  // reversibility axis, so nix/restic/any other tool's --prune-style flag
  // is caught the same way without naming it.
  if (/--(prune|gc|compact|vacuum)\b/i.test(text) && assessReversibility(text, headCommand).highConsequence) {
    return { matched: true, signal: 'B', reason: '--prune/--gc/--compact/--vacuum + high-consequence target' };
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
  // A "scope-widening" flag (--all/-a) paired with ANY destructive verb
  // (not just "delete") — widening a cleanup/removal operation from "one
  // thing" to "everything" is itself a consequence-raising signal, e.g.
  // "docker system prune -a" (all unused resources, not just dangling
  // ones) or "kubectl delete pods --all".
  if (/(--all\b|(?<!\w)-a\b)/i.test(text) && DESTRUCTIVE_VERB_RE.test(text)) {
    return { matched: true, signal: 'B', reason: '--all/-a + destructive verb (scope-widening)' };
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
    () => matchesDestructiveVerbAndTarget(text, headCommand),
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
  splitMorphology,
  matchesFusedVerbPrefix,
  matchesPowerShellVerbNoun,
  verbFamily,
  VERB_FAMILIES,
  DESTRUCTIVE_VERBS,
  IRREDUCIBLE_HEADS,
};
