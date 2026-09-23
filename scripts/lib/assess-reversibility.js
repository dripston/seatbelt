'use strict';

// Reversibility axis: scores a candidate invocation on CONSEQUENCE
// signals, independent of which verb or binary is involved. Built
// because "npm uninstall lodash" and "brew uninstall --force
// postgresql@14" share a verb (uninstall) but have opposite real-world
// consequences (reinstalling a JS dependency from package.json is
// trivial and instant; force-uninstalling a system package can break
// other software depending on it, with no single command to undo it).
// A destructive verb alone is not a reliable risk signal — this module
// answers "how bad would it be if this went wrong," and structural-
// danger.js's caller combines that with the verb signal before deciding
// to ask.
//
// Every function here is a pure predicate over the real-invocation text
// (same textForMatching input as structural-danger.js) plus, where
// needed, the head command. None of them name a specific tool/binary —
// they classify based on the shape of the TARGET/ARGUMENT, not on which
// program is running.

/**
 * Scope of target: project-local vs. system vs. remote vs. whole-device.
 * Project-local, cwd-relative paths are low risk (scoped to one
 * directory, usually already under version control or trivially
 * rebuilt). System paths and whole-device references are high risk
 * (affect the operating environment or persistent storage beyond any
 * one project). Remote/shared-reach targets are handled by
 * assessReach() below, kept separate since "remote" and "system-path"
 * are different axes that can combine.
 */
const PROJECT_LOCAL_PATH_RE = /(^|[\s"'])\.{1,2}\/[\w./-]*|(^|[\s"'])(?!\/)[\w-]+\/[\w./-]*(?=[\s"']|$)/;
// /dev/sdX-style paths, OR a bare device-identifier-shaped token (diskN,
// sdN, nvmeN, hdN as a standalone word) — the latter covers platform
// tools (e.g. macOS diskutil) that address whole devices by a bare
// identifier rather than a /dev/ path. This is a target-SHAPE signal
// (a short alnum token matching a known device-naming convention), not a
// tool-name check.
const WHOLE_DEVICE_RE = /\/dev\/(sd|nvme|xvd|hd)\w*(?!\/)|\b(disk|sd|nvme|xvd|hd)\d+\b/i;
const SYSTEM_PATH_RE = /(^|[\s"'])(\/|\/etc|\/var|\/usr|\/boot|\/bin|\/sbin|\/lib|\/root|\/home)(?=[\s"'/]|$)/;
// A broader "any absolute path that isn't project-local" scope was tried
// and reverted: it coincidentally matched things like a URL path segment
// or a --outDir /tmp/x flag value on an otherwise benign command (e.g.
// "npm run build -- --outDir /tmp/output"), producing false positives on
// common, harmless commands. Kept narrower and more conservative instead:
// /home is added to the explicit system-path list (user data under
// /home/* is a real, common, high-consequence target — e.g. shred on a
// user's file), but a fully generic "any absolute path" check is NOT
// used, since it can't reliably distinguish a real destructive target
// path from an unrelated flag value or URL fragment without much richer
// per-command argument parsing than this project does. Documented,
// honest limitation rather than a broad rule that trades new false
// positives for one narrow catch.

function assessScope(text) {
  if (typeof text !== 'string') return 'unknown';
  if (WHOLE_DEVICE_RE.test(text)) return 'whole-device';
  if (SYSTEM_PATH_RE.test(text)) return 'system';
  if (PROJECT_LOCAL_PATH_RE.test(text)) return 'project-local';
  return 'unknown';
}

/**
 * Re-derivability: does the target look like something regenerable from
 * committed state (dependency trees, build output, caches) vs. something
 * that represents unique, non-regenerable state (a database, a remote
 * branch, user data, a volume)? A regenerable target lowers risk
 * regardless of the verb used against it.
 */
const REDERIVABLE_NAME_RE =
  /\b(node_modules|\.venv|venv|__pycache__|target|dist|build|\.next|\.nuxt|\.cache|\.parcel-cache|coverage|\.pytest_cache|\.turbo|\.gradle|\.terraform|vendor|Pods|DerivedData|\.tox|\.mypy_cache|out|bin\/obj|obj)\b/i;

function assessRederivable(text) {
  if (typeof text !== 'string') return false;
  return REDERIVABLE_NAME_RE.test(text);
}

/**
 * Reach: does the command act only on this machine, or on something
 * shared with other people/systems — a package registry, a cloud
 * account, a remote host, a cluster, a remote git ref, or a resource
 * explicitly labeled as a shared/production environment? Shared reach
 * raises risk even for an otherwise low-scope-looking command, because
 * the blast radius extends beyond the person running it. A
 * "production"/"prod"/"live"-labeled target is treated as shared reach
 * regardless of physical location, since by definition it's a resource
 * other people/systems depend on — this is a consequence signal, not
 * strictly a network-locality one, which is why it lives here rather
 * than only in structural-danger.js's own separate prod-target check.
 */
// Any "scheme://" URI is treated as remote reach generically (s3, gs,
// oci, azure, abfss, https, ssh, sftp, ftp, and any future scheme) rather
// than enumerating protocols one at a time — the "://" shape itself is
// the structural signal, not which specific scheme name precedes it.
const REMOTE_REACH_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bremote:[\w./-]+|\borigin\/|\brefs\/(heads|remotes)\/|@[\w.-]+:[\w./-]+|\b\w+@[\w.-]+\b/i;
const CLOUD_ACCOUNT_HEADS_HINT_RE =
  /\b(aws|gcloud|az|doctl|linode-cli|kubectl|nomad|consul|vault|gh|glab|helm|terraform)\b/i;
const SHARED_ENVIRONMENT_LABEL_RE = /\b(prod|production|live)[\w-]*\b/i;
// A cloud-CLI head command only counts as "shared-account" reach when the
// text does NOT look like a purely local/read-only subcommand of that
// CLI (e.g. "terraform state rm" only edits local state tracking,
// "aws configure list" reads local config) — otherwise every invocation
// of a cloud CLI, including harmless ones, would be flagged. Same
// discipline as structural-danger.js's EXPLICIT_READONLY_VERB_RE.
const LOCAL_SUBCOMMAND_HINT_RE = /\b(state|config|configure|context|version|help)\b/i;
const EXPLICIT_READONLY_VERB_RE = /\b(ls|list|get|describe|view|show|status|inspect|plan)\b/i;

function assessReach(text, headCommand) {
  if (typeof text !== 'string') return 'local';
  if (REMOTE_REACH_RE.test(text)) return 'remote';
  if (SHARED_ENVIRONMENT_LABEL_RE.test(text)) return 'shared-account';
  if (
    headCommand &&
    CLOUD_ACCOUNT_HEADS_HINT_RE.test(headCommand) &&
    !LOCAL_SUBCOMMAND_HINT_RE.test(text) &&
    !EXPLICIT_READONLY_VERB_RE.test(text)
  ) {
    return 'shared-account';
  }
  return 'local';
}

/**
 * Confirmability: does the command carry a flag that suppresses a
 * confirmation prompt the underlying tool would otherwise show? Presence
 * of such a flag raises risk regardless of verb, because the invoker (or
 * an agent acting on their behalf) has explicitly opted out of the
 * tool's own safety net — a signal of intent to proceed without review.
 */
// Matches -f both standalone and bundled with other single-letter flags
// (e.g. git's "-fd" bundles force+directories into one token), since Unix
// tools commonly bundle short flags together. Deliberately excludes the
// specific "-rf"/"-fr" combination on "rm": rm is not interactive by
// default (there is no confirmation prompt for -f to suppress — it just
// means "ignore missing files"), so treating rm -rf's own -f as a
// suppressed-confirmation signal would flag nearly every rm -rf
// invocation, including the routine, low-consequence ones this axis
// exists to distinguish from truly dangerous ones. -y is intentionally
// NOT bundle-matched (kept as standalone \b-y\b only): "y" is a common
// letter inside unrelated bundled flag combinations, and bundling it
// would risk false-positiving on flags that merely happen to contain a y.
const RM_RF_RE = /\brm\b\s+(?:-{1,2}[A-Za-z][\w-]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*[rf][a-zA-Z]*\b/i;
// Colon-value flag syntax (fastlane and similar Ruby-style CLIs write
// flags as "key:value" rather than "--key value", e.g. "force:true",
// "skip_clean:false") — force:true / confirm:false / skip_x:false are
// the same semantic signal as --force / --no-confirm, just a different
// punctuation convention. Matched generically on the key name plus
// boolean-looking value, not on any specific tool.
const COLON_VALUE_SUPPRESSION_RE = /\b(force|confirm|yes|interactive):(true|yes|1)\b|\b(skip_\w*|no_confirm\w*):(false|no|0)\b/i;
const SUPPRESSED_CONFIRMATION_RE =
  /(--force\b|(?<!\w)-[a-zA-Z]*f[a-zA-Z]*\b|--yes\b|(?<!\w)-y\b|--no-confirm\b|--noconfirm\b|--non-interactive\b|--confirm\b|\/f\b|\/q\b|--assume-yes\b)/i;

function assessConfirmabilitySuppressed(text) {
  if (typeof text !== 'string') return false;
  if (COLON_VALUE_SUPPRESSION_RE.test(text)) return true;
  // Strip a bundled rm -rf/-fr flag before checking, so rm's own -f
  // doesn't count as a suppressed-confirmation signal (see comment above).
  const withoutRmRf = text.replace(RM_RF_RE, (m) => m.replace(/-[a-zA-Z]+/, '-'));
  return SUPPRESSED_CONFIRMATION_RE.test(withoutRmRf);
}

/**
 * Combines all four axes into a single risk assessment. Returns
 * { highConsequence: boolean, reasons: string[] } — highConsequence is
 * true if the target is NOT project-local-and-rederivable AND at least
 * one other risk-raising factor is present (system/whole-device scope,
 * shared/remote reach, or a suppressed-confirmation flag). This is the
 * gate structural-danger.js's signal A uses: a destructive verb alone is
 * insufficient; a destructive verb PLUS a high-consequence target is
 * what triggers ask.
 */
function assessReversibility(text, headCommand) {
  const scope = assessScope(text);
  const rederivable = assessRederivable(text);
  const reach = assessReach(text, headCommand);
  const confirmSuppressed = assessConfirmabilitySuppressed(text);

  const reasons = [];

  // A project-local, re-derivable target is the clearest "low consequence"
  // case: even if something goes wrong, the fix is "reinstall/rebuild."
  // This overrides everything else EXCEPT an explicit suppressed-confirmation
  // flag, which signals real intent to bypass a safety net regardless of
  // how re-derivable the target looks (e.g. someone force-uninstalling a
  // project-local venv is still choosing to skip a prompt).
  const looksLowConsequence = scope === 'project-local' && rederivable;

  if (scope === 'whole-device') reasons.push('targets an entire device');
  if (scope === 'system') reasons.push('targets a broad system path');
  if (reach === 'remote') reasons.push('reaches a remote/shared resource');
  if (reach === 'shared-account') reasons.push('acts through a shared-account CLI');
  if (confirmSuppressed) reasons.push('suppresses a confirmation prompt');

  const highConsequence = confirmSuppressed
    ? reasons.length > 0
    : !looksLowConsequence && reasons.length > 0;

  return {
    highConsequence,
    scope,
    rederivable,
    reach,
    confirmSuppressed,
    reasons,
  };
}

module.exports = {
  assessScope,
  assessRederivable,
  assessReach,
  assessConfirmabilitySuppressed,
  assessReversibility,
};
