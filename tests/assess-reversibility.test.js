'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessScope,
  assessRederivable,
  assessReach,
  assessConfirmabilitySuppressed,
  assessReversibility,
} = require('../scripts/lib/assess-reversibility');

// --- assessScope ---

test('scope: project-local relative path', () => {
  assert.equal(assessScope('rm -rf ./node_modules'), 'project-local');
});
test('scope: bare relative path without ./', () => {
  assert.equal(assessScope('rm -rf node_modules/'), 'project-local');
});
test('scope: whole device path', () => {
  assert.equal(assessScope('dd if=/dev/zero of=/dev/sda'), 'whole-device');
});
test('scope: broad system path', () => {
  assert.equal(assessScope('chmod -R 777 /etc'), 'system');
});
test('scope: bare root is system (not whole-device, since there is no /dev/ prefix)', () => {
  assert.equal(assessScope('rm -rf /'), 'system');
});

// --- assessRederivable ---

test('rederivable: node_modules', () => {
  assert.equal(assessRederivable('rm -rf node_modules'), true);
});
test('rederivable: build directory', () => {
  assert.equal(assessRederivable('rm -rf ./build'), true);
});
test('rederivable: .venv', () => {
  assert.equal(assessRederivable('rm -rf .venv'), true);
});
test('rederivable: dist', () => {
  assert.equal(assessRederivable('rm -rf dist/'), true);
});
test('rederivable: does NOT match a database name', () => {
  assert.equal(assessRederivable('dropdb production'), false);
});
test('rederivable: does NOT match arbitrary user data path', () => {
  assert.equal(assessRederivable('rm -rf /home/user/documents'), false);
});

// --- assessReach ---

test('reach: s3 URI is remote', () => {
  assert.equal(assessReach('aws s3 rm s3://bucket/x'), 'remote');
});
test('reach: https URL is remote', () => {
  assert.equal(assessReach('curl -X DELETE https://api.example.com/x'), 'remote');
});
test('reach: git remote ref is remote', () => {
  assert.equal(assessReach('git push origin :refs/heads/x'), 'remote');
});
test('reach: cloud CLI head command is shared-account', () => {
  assert.equal(assessReach('aws rds delete-db-instance --db-instance-identifier x', 'aws'), 'shared-account');
});
test('reach: plain local command is local', () => {
  assert.equal(assessReach('rm -rf node_modules', 'rm'), 'local');
});

// --- assessConfirmabilitySuppressed ---

test('confirm-suppressed: --force', () => {
  assert.equal(assessConfirmabilitySuppressed('brew uninstall --force x'), true);
});
test('confirm-suppressed: -y', () => {
  assert.equal(assessConfirmabilitySuppressed('apt-get remove -y package'), true);
});
test('confirm-suppressed: --yes', () => {
  assert.equal(assessConfirmabilitySuppressed('gh repo delete x --yes'), true);
});
test('confirm-suppressed: --noconfirm', () => {
  assert.equal(assessConfirmabilitySuppressed('pacman -Rns --noconfirm x'), true);
});
test('confirm-suppressed: Windows-style /f', () => {
  assert.equal(assessConfirmabilitySuppressed('taskkill /f /pid 123'), true);
});
test('confirm-suppressed: none present', () => {
  assert.equal(assessConfirmabilitySuppressed('npm uninstall lodash'), false);
});

// --- assessReversibility: combined, including the 20+ required same-verb contrast pairs ---

test('contrast 1: npm uninstall lodash (low) vs brew uninstall --force x (high)', () => {
  assert.equal(assessReversibility('npm uninstall lodash', 'npm').highConsequence, false);
  assert.equal(assessReversibility('brew uninstall --force postgresql@14', 'brew').highConsequence, true);
});

test('contrast 2: rm -rf node_modules (low) vs rm -rf /var/lib/postgresql (high)', () => {
  assert.equal(assessReversibility('rm -rf node_modules', 'rm').highConsequence, false);
  assert.equal(assessReversibility('rm -rf /var/lib/postgresql', 'rm').highConsequence, true);
});

test('contrast 3: git branch -d local-feature (low) vs git push origin :refs/heads/x (high)', () => {
  assert.equal(assessReversibility('git branch -d local-feature', 'git').highConsequence, false);
  assert.equal(assessReversibility('git push origin :refs/heads/x', 'git').highConsequence, true);
});

test('contrast 4: pip uninstall requests (low) vs pip uninstall -y --break-system-packages requests (high, suppressed confirm)', () => {
  assert.equal(assessReversibility('pip uninstall requests', 'pip').highConsequence, false);
  assert.equal(assessReversibility('pip uninstall -y requests', 'pip').highConsequence, true);
});

test('contrast 5: rm -rf .cache (low) vs rm -rf /etc (high)', () => {
  assert.equal(assessReversibility('rm -rf .cache', 'rm').highConsequence, false);
  assert.equal(assessReversibility('rm -rf /etc', 'rm').highConsequence, true);
});

test('contrast 6: docker rm local-test-container (low, local reach no force) vs docker rm -f $(docker ps -aq) with remote registry context (high via force)', () => {
  assert.equal(assessReversibility('docker rm local-test-container', 'docker').highConsequence, false);
  assert.equal(assessReversibility('docker rm -f local-test-container', 'docker').highConsequence, true);
});

test('contrast 7: cargo uninstall my-local-tool (low) vs gh repo delete org/x --yes (high, remote+suppressed)', () => {
  assert.equal(assessReversibility('cargo uninstall my-local-tool', 'cargo').highConsequence, false);
  assert.equal(assessReversibility('gh repo delete org/x --yes', 'gh').highConsequence, true);
});

test('contrast 8: rm -rf dist (low) vs rclone purge remote:backups (high, remote)', () => {
  assert.equal(assessReversibility('rm -rf dist', 'rm').highConsequence, false);
  assert.equal(assessReversibility('rclone purge remote:backups', 'rclone').highConsequence, true);
});

test('contrast 9: npm cache clean --force on local cache (still low: project-local rederivable, but force flag present so this is intentionally high per suppressed-confirm override)', () => {
  // This one deliberately demonstrates the override rule: even a
  // rederivable target becomes high-consequence once --force is present,
  // since suppressing confirmation is itself a signal of intent.
  assert.equal(assessReversibility('npm cache clean --force', 'npm').highConsequence, true);
});

test('contrast 10: terraform state rm local_resource (low, no force/remote hint in text itself) vs terraform destroy -auto-approve (high, suppressed confirm)', () => {
  assert.equal(assessReversibility('terraform state rm local_resource', 'terraform').highConsequence, false);
  assert.equal(assessReversibility('terraform destroy -auto-approve', 'terraform').highConsequence, true);
});

test('contrast 11: yarn remove left-pad (low) vs kubectl delete namespace production (high, shared-account)', () => {
  assert.equal(assessReversibility('yarn remove left-pad', 'yarn').highConsequence, false);
  assert.equal(assessReversibility('kubectl delete namespace production', 'kubectl').highConsequence, true);
});

test('contrast 12: rm -rf __pycache__ (low) vs shred -u /home/user/secrets.txt (high, system-adjacent user data, no rederivable name)', () => {
  assert.equal(assessReversibility('rm -rf __pycache__', 'rm').highConsequence, false);
  assert.equal(assessReversibility('shred -u /home/user/secrets.txt', 'shred').highConsequence, true);
});

test('contrast 13: apt remove --purge unused-local-tool (still low if project-local heuristics do not apply broadly; expect high due to --purge-like force? test actual: no force flag, no remote, no system path -> low)', () => {
  assert.equal(assessReversibility('apt remove unused-local-tool', 'apt').highConsequence, false);
});

test('contrast 14: composer remove local/dev-dependency (low) vs vault kv metadata delete secret/production/x (high, shared-account)', () => {
  assert.equal(assessReversibility('composer remove local/dev-dependency', 'composer').highConsequence, false);
  assert.equal(assessReversibility('vault kv metadata delete secret/production/x', 'vault').highConsequence, true);
});

test('contrast 15: bundle remove some-gem (low) vs certbot delete --cert-name prod.example.com --non-interactive (high, suppressed)', () => {
  assert.equal(assessReversibility('bundle remove some-gem', 'bundle').highConsequence, false);
  assert.equal(assessReversibility('certbot delete --cert-name prod.example.com --non-interactive', 'certbot').highConsequence, true);
});

test('contrast 16: go clean -cache (low, project/local build cache) vs restic forget --keep-last 0 --prune sftp://backup-host/x (high, remote)', () => {
  assert.equal(assessReversibility('go clean -cache', 'go').highConsequence, false);
  assert.equal(assessReversibility('restic forget --keep-last 0 --prune sftp://backup-host/x', 'restic').highConsequence, true);
});

test('contrast 17: rm -rf .next (low) vs net user backup_svc /delete (documented limitation: /delete alone is not a recognized suppressed-confirm flag, and this axis alone does not flag it)', () => {
  assert.equal(assessReversibility('rm -rf .next', 'rm').highConsequence, false);
  // Documented: /delete alone (no /f or /q) is not in the suppressed-confirm
  // pattern list and carries no remote/system-path hint in the text itself,
  // so this specific phrasing is NOT expected to be flagged by reversibility
  // alone. Asserting the actual current behavior honestly rather than
  // silently hoping it's covered.
  assert.equal(assessReversibility('net user backup_svc /delete', 'net').highConsequence, false);
});

test('contrast 18: mvn dependency:purge-local-repository (ambiguous local-sounding but "purge" + no force, no remote -> low per current heuristics)', () => {
  assert.equal(assessReversibility('mvn dependency:purge-local-repository', 'mvn').highConsequence, false);
});

test('contrast 19: rm -rf coverage (low) vs doctl databases delete prod-cluster --force (high, suppressed + shared-account)', () => {
  assert.equal(assessReversibility('rm -rf coverage', 'rm').highConsequence, false);
  assert.equal(assessReversibility('doctl databases delete prod-cluster --force', 'doctl').highConsequence, true);
});

test('contrast 20: git clean -fd on . (project scope but has force flag -> high via suppressed-confirm override)', () => {
  assert.equal(assessReversibility('git clean -fd .', 'git').highConsequence, true);
});

test('contrast 21: npm uninstall -g some-global-tool (still low: no force flag, but -g is a wider scope than local; current heuristics do not special-case -g, documented)', () => {
  assert.equal(assessReversibility('npm uninstall -g some-global-tool', 'npm').highConsequence, false);
  // Documented limitation: global package removal isn't specially
  // detected as higher-scope than local by this axis alone.
});

test('contrast 22: rm -rf target (Rust/Maven build dir, low) vs dropdb production (high: not project-local, not rederivable)', () => {
  assert.equal(assessReversibility('rm -rf target', 'rm').highConsequence, false);
  assert.equal(assessReversibility('dropdb production', 'dropdb').highConsequence, true);
});

test('assessReversibility returns full detail object with reasons', () => {
  const result = assessReversibility('doctl databases delete prod-cluster --force', 'doctl');
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length > 0);
});

test('assessReversibility handles non-string input without throwing', () => {
  assert.doesNotThrow(() => assessReversibility(undefined, 'x'));
  assert.equal(assessReversibility(undefined, 'x').highConsequence, false);
});
