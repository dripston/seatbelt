'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesDestructiveVerbAndTarget,
  matchesDestructiveFlags,
  matchesHighRiskTarget,
  matchesInlineDestructiveQuery,
  matchesPublishShape,
  matchesIrreducible,
  evaluateStructuralDanger,
} = require('../scripts/lib/structural-danger');

// --- Signal A: destructive verb + target ---

test('A: flux delete kustomization x matches', () => {
  assert.equal(matchesDestructiveVerbAndTarget('flux delete kustomization production-apps').matched, true);
});
test('A: doctl databases delete x matches', () => {
  assert.equal(matchesDestructiveVerbAndTarget('doctl databases delete prod-postgres-cluster').matched, true);
});
test('A: rclone purge remote:x matches', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rclone purge remote:production-backups').matched, true);
});
test('A: influx bucket delete x matches', () => {
  assert.equal(matchesDestructiveVerbAndTarget('influx bucket delete --name prod-metrics').matched, true);
});
test('A: git update-ref -d x matches (drop-like verb "rm" not needed, "delete" style word not present but -d... )', () => {
  // git update-ref uses -d, not the word "delete" — this specific phrasing
  // is NOT expected to match signal A (no destructive-verb WORD present).
  // Documented here as a known miss for this signal alone; see if another
  // signal catches it in the combined evaluateStructuralDanger test below.
  assert.equal(matchesDestructiveVerbAndTarget('git update-ref -d refs/heads/release-2.3').matched, false);
});
test('A: linode-cli linodes delete x matches', () => {
  assert.equal(matchesDestructiveVerbAndTarget('linode-cli linodes delete 12345678').matched, true);
});
test('A: kubectl delete namespace x matches (already-covered tool, still structurally valid)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('kubectl delete namespace production').matched, true);
});
test('A: does NOT match a bare verb with no target', () => {
  assert.equal(matchesDestructiveVerbAndTarget('git status').matched, false);
});
test('A: does NOT match "delete" appearing with nothing following it', () => {
  assert.equal(matchesDestructiveVerbAndTarget('echo delete').matched, false);
});
test('A: does NOT match "npm uninstall left-pad" (uninstall deliberately excluded: routine, reversible package removal, not infra/data destruction)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('npm uninstall left-pad').matched, false);
});
test('A: does NOT match "git reset --help" (--help is not a real target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('git reset --help').matched, false);
});
test('A: does NOT match "rm --help" (--help is not a real target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rm --help').matched, false);
});
test('A: does NOT match "rm important-file.txt" (bare rm with no -r/-f flag, low-risk, covered separately if ever needed)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rm important-file.txt').matched, false);
});

// --- Signal B: destructive flags, any binary ---

test('B: --no-preserve-root matches', () => {
  assert.equal(matchesDestructiveFlags('rm -rf --no-preserve-root /', 'rm').matched, true);
});
test('B: git reset --hard matches', () => {
  assert.equal(matchesDestructiveFlags('git reset --hard HEAD~3', 'git').matched, true);
});
test('B: --prune with a covered tool name matches', () => {
  assert.equal(matchesDestructiveFlags('docker system prune -a --volumes', 'docker').matched, true);
});
test('B: kill -9 via pkill head matches', () => {
  assert.equal(matchesDestructiveFlags('pkill -9 -f postgres', 'pkill').matched, true);
});
test('B: --recursive + delete matches', () => {
  assert.equal(matchesDestructiveFlags('some-tool --recursive delete /data', 'some-tool').matched, true);
});
test('B: --force + destructive verb matches', () => {
  assert.equal(matchesDestructiveFlags('gsutil -m rm -r gs://bucket/**', 'gsutil').matched, true);
});
test('B: --all + delete matches', () => {
  assert.equal(matchesDestructiveFlags('sometool delete --all', 'sometool').matched, true);
});
test('B: rsync --delete matches', () => {
  assert.equal(matchesDestructiveFlags('rsync -av --delete /dev/null/ /var/www/production/', 'rsync').matched, true);
});
test('B: does NOT match a bare --force with no destructive verb nearby', () => {
  assert.equal(matchesDestructiveFlags('npm install --force', 'npm').matched, false);
});
test('B: does NOT match plain kill without -9', () => {
  assert.equal(matchesDestructiveFlags('kill 1234', 'kill').matched, false);
});
test('B: does NOT match "git rm -r --cached x" (untracking, not deleting from disk - common, safe operation)', () => {
  assert.equal(matchesDestructiveFlags('git rm -r --cached __pycache__', 'git').matched, false);
});
test('B: DOES still match "git rm -rf x" without --cached (real recursive filesystem delete)', () => {
  assert.equal(matchesDestructiveFlags('git rm -rf some-dir/', 'git').matched, true);
});

// --- Signal C: high-risk targets ---

test('C: raw device path matches', () => {
  assert.equal(matchesHighRiskTarget('wipefs -a /dev/nvme0n1').matched, true);
});
test('C: broad system path (/etc) matches', () => {
  assert.equal(matchesHighRiskTarget('chmod -R 777 /etc').matched, true);
});
test('C: bare root path matches', () => {
  assert.equal(matchesHighRiskTarget('rm -rf /').matched, true);
});
test('C: s3:// URI matches', () => {
  assert.equal(matchesHighRiskTarget('aws s3 rm s3://prod-bucket --recursive').matched, true);
});
test('C: gs:// URI matches', () => {
  assert.equal(matchesHighRiskTarget('gsutil rm -r gs://prod-user-uploads/**').matched, true);
});
test('C: production-named target matches', () => {
  assert.equal(matchesHighRiskTarget('systemctl stop production-service').matched, true);
});
test('C: "prod" substring in a resource name matches', () => {
  assert.equal(matchesHighRiskTarget('doctl databases delete prod-postgres-cluster').matched, true);
});
test('C: does NOT match an ordinary relative path', () => {
  assert.equal(matchesHighRiskTarget('rm -rf ./dist').matched, false);
});
test('C: does NOT match /home/user paths', () => {
  assert.equal(matchesHighRiskTarget('ls /home/user/projects').matched, false);
});
test('C: does NOT match a staging-named target', () => {
  assert.equal(matchesHighRiskTarget('dropdb --if-exists staging').matched, false);
});
test('C: does NOT match "export NODE_ENV=production" (no action verb, just an env var assignment)', () => {
  assert.equal(matchesHighRiskTarget('export NODE_ENV=production').matched, false);
});
test('C: does NOT match a comment or filename mentioning production with no action verb', () => {
  assert.equal(matchesHighRiskTarget('cat production-notes.md').matched, false);
});
test('C: DOES match production with a stop/action verb present', () => {
  assert.equal(matchesHighRiskTarget('systemctl stop production-service').matched, true);
});
test('C: does NOT match "aws s3 ls s3://..." (explicit read-only verb "ls" present)', () => {
  assert.equal(matchesHighRiskTarget('aws s3 ls s3://prod-bucket/rm-rf-backup-script.sh').matched, false);
});
test('C: DOES still match a destructive s3:// operation with no read-only verb', () => {
  assert.equal(matchesHighRiskTarget('aws s3 rm s3://prod-bucket --recursive').matched, true);
});
test('C: does NOT match "kubectl describe pod x" even with a device-path-looking argument (describe is read-only)', () => {
  assert.equal(matchesHighRiskTarget('kubectl describe pod /dev/console-logger').matched, false);
});

// --- Signal D: inline destructive query execution ---

test('D: redis-cli FLUSHALL with -e style not needed (bare command) does NOT match this signal alone', () => {
  // redis-cli FLUSHALL has no -e/-c/--eval flag - this signal specifically
  // targets INLINE query flags. Documented as intentionally out of this
  // signal's scope; combined evaluation may still catch it via another path.
  assert.equal(matchesInlineDestructiveQuery('redis-cli FLUSHALL').matched, false);
});
test('D: mongosh --eval with dropDatabase matches', () => {
  assert.equal(matchesInlineDestructiveQuery('mongosh --eval "db.getSiblingDB(\'x\').dropDatabase()"').matched, true);
});
test('D: cqlsh -e with DROP KEYSPACE matches', () => {
  assert.equal(matchesInlineDestructiveQuery('cqlsh -e "DROP KEYSPACE production_data;"').matched, true);
});
test('D: psql -c with DROP DATABASE matches', () => {
  assert.equal(matchesInlineDestructiveQuery('psql -c "DROP DATABASE production;"').matched, true);
});
test('D: mysql -e with DROP TABLE matches', () => {
  assert.equal(matchesInlineDestructiveQuery('mysql -e "DROP TABLE users;"').matched, true);
});
test('D: --execute flag with TRUNCATE matches', () => {
  assert.equal(matchesInlineDestructiveQuery('sometool --execute "TRUNCATE TABLE logs;"').matched, true);
});
test('D: --command flag with DELETE FROM matches', () => {
  assert.equal(matchesInlineDestructiveQuery('sometool --command "DELETE FROM users;"').matched, true);
});
test('D: does NOT match -e with a harmless query', () => {
  assert.equal(matchesInlineDestructiveQuery('psql -c "SELECT * FROM users;"').matched, false);
});
test('D: does NOT match a destructive keyword with no exec flag', () => {
  assert.equal(matchesInlineDestructiveQuery('cat schema.sql | grep DROP').matched, false);
});
test('D: does NOT match EXPLAIN-prefixed destructive SQL as inline flag alone requires the flag AND keyword, EXPLAIN presence is irrelevant here', () => {
  // this signal doesn't understand EXPLAIN semantics; it will still fire
  // on "psql -c EXPLAIN DELETE..." since -c + DELETE FROM both present.
  // Documented as a known false-positive risk for signal D specifically.
  assert.equal(matchesInlineDestructiveQuery('psql -c "EXPLAIN DELETE FROM users WHERE id=1;"').matched, true);
});

// --- Signal E: publish/release shape ---

test('E: poetry publish --build matches (publish verb, no explicit registry arg but "publish" + build is borderline)', () => {
  // poetry publish --build has no registry-shaped argument at all -
  // documented limitation, expect this NOT to match signal E alone.
  assert.equal(matchesPublishShape('poetry publish --build').matched, false);
});
test('E: dotnet nuget push with --source matches', () => {
  assert.equal(
    matchesPublishShape('dotnet nuget push mypackage.1.0.0.nupkg --source https://api.nuget.org/v3/index.json').matched,
    true
  );
});
test('E: helm push with oci:// registry matches', () => {
  assert.equal(matchesPublishShape('helm push mychart-1.2.0.tgz oci://registry.example.com/charts').matched, true);
});
test('E: pip install --index-url matches', () => {
  assert.equal(matchesPublishShape('pip install --index-url https://test.pypi.org/simple/ mypackage').matched, false);
  // "install" is not in RELEASE_VERB_RE (publish|upload|release|push) -
  // documented: pip install with a custom index is NOT publish-shaped,
  // it's a different risk class (supply chain), out of scope for signal E.
});
test('E: twine upload dist/* matches', () => {
  assert.equal(matchesPublishShape('twine upload dist/*').matched, true);
});
test('E: gem push mygem.gem matches', () => {
  assert.equal(matchesPublishShape('gem push mygem-1.0.0.gem').matched, true);
});
test('E: docker push to a registry matches', () => {
  assert.equal(matchesPublishShape('docker push myregistry.example.com/myimage:latest').matched, true);
});
test('E: does NOT match npm run push-notifications (no registry arg)', () => {
  assert.equal(matchesPublishShape('npm run push-notifications').matched, false);
});
test('E: does NOT match a bare git push with no registry-shaped argument', () => {
  assert.equal(matchesPublishShape('git push origin main').matched, false);
});
test('E: does NOT match "release notes" prose with no verb+registry shape', () => {
  assert.equal(matchesPublishShape('cat RELEASE_NOTES.md').matched, false);
});

// --- Signal F: irreducible list ---
// matchesIrreducible checks the HEAD COMMAND specifically (not free-text
// search), so every call here passes the head command as the second
// argument, matching how classifySegment's real output is used in
// production. This was a deliberate fix (see comment in
// structural-danger.js): the original free-text version wrongly matched
// these words anywhere in the string, including inside URLs/filenames.

test('F: poweroff matches', () => {
  assert.equal(matchesIrreducible('poweroff', 'poweroff').matched, true);
});
test('F: halt matches', () => {
  assert.equal(matchesIrreducible('halt', 'halt').matched, true);
});
test('F: reboot matches', () => {
  assert.equal(matchesIrreducible('reboot', 'reboot').matched, true);
});
test('F: shutdown matches', () => {
  assert.equal(matchesIrreducible('shutdown -h now', 'shutdown').matched, true);
});
test('F: init 0 matches', () => {
  assert.equal(matchesIrreducible('init 0', 'init').matched, true);
});
test('F: mkfs.ext4 matches', () => {
  assert.equal(matchesIrreducible('mkfs.ext4 /dev/sda1', 'mkfs.ext4').matched, true);
});
test('F: wipefs matches', () => {
  assert.equal(matchesIrreducible('wipefs -a /dev/nvme0n1', 'wipefs').matched, true);
});
test('F: dd with if= matches', () => {
  assert.equal(matchesIrreducible('dd if=/dev/zero of=/dev/sda', 'dd').matched, true);
});
test('F: shred matches', () => {
  assert.equal(matchesIrreducible('shred -u secrets.txt', 'shred').matched, true);
});
test('F: does NOT match an unrelated command', () => {
  assert.equal(matchesIrreducible('npm run build', 'npm').matched, false);
});
test('F: does NOT match "wipefs" appearing inside a URL/filename (head command is curl, not wipefs)', () => {
  assert.equal(
    matchesIrreducible('curl -s https://raw.githubusercontent.com/org/repo/main/scripts/wipefs-notes.md', 'curl').matched,
    false
  );
});
test('F: "init" alone (not followed by 0) does not match, e.g. terraform init has its own head command anyway', () => {
  assert.equal(matchesIrreducible('init', 'init').matched, false);
});

// --- Combined evaluation ---

test('combined: git update-ref -d is caught via signal C (system-path-free but no) - actually check what catches it', () => {
  const result = evaluateStructuralDanger('git update-ref -d refs/heads/release-2.3', 'git');
  // Documented: this specific holdout failure is NOT expected to be
  // caught by any of signals A-F as currently scoped (no destructive verb
  // WORD, no flag combo, no high-risk target keyword, no query, no
  // publish shape, not on the irreducible list). This is an HONEST
  // remaining gap, asserted explicitly rather than silently hoped-fixed.
  assert.equal(result, null);
});

test('combined: redis-cli FLUSHALL is NOT caught by any current signal (bare command, no flag/target/exec-flag shape)', () => {
  const result = evaluateStructuralDanger('redis-cli FLUSHALL', 'redis-cli');
  // FLUSHALL is a bare subcommand-like argument with no verb from our
  // destructive-verb list, no flags, no path, no inline-exec flag.
  // Honest documented gap - not silently claimed fixed.
  assert.equal(result, null);
});

test('combined: poweroff is caught via signal F', () => {
  const result = evaluateStructuralDanger('poweroff', 'poweroff');
  assert.ok(result);
  assert.equal(result.signal, 'F');
});

test('combined: flux delete kustomization x is caught via signal A', () => {
  const result = evaluateStructuralDanger('flux delete kustomization production-apps --namespace flux-system', 'flux');
  assert.ok(result);
  assert.equal(result.signal, 'A');
});

test('combined: rsync mirror-wipe is caught via signal B or C', () => {
  const result = evaluateStructuralDanger('rsync -av --delete /dev/null/ /var/www/production/', 'rsync');
  assert.ok(result);
});

test('combined: mongosh dropDatabase is caught via signal D', () => {
  const result = evaluateStructuralDanger('mongosh --eval "db.getSiblingDB(\'x\').dropDatabase()"', 'mongosh');
  assert.ok(result);
  assert.equal(result.signal, 'D');
});

test('combined: dotnet nuget push is caught via signal E', () => {
  const result = evaluateStructuralDanger(
    'dotnet nuget push mypackage.1.0.0.nupkg --source https://api.nuget.org/v3/index.json',
    'dotnet'
  );
  assert.ok(result);
  assert.equal(result.signal, 'E');
});

test('combined: an ordinary safe command matches nothing', () => {
  assert.equal(evaluateStructuralDanger('npm run dev', 'npm'), null);
  assert.equal(evaluateStructuralDanger('git status', 'git'), null);
  assert.equal(evaluateStructuralDanger('ls -la', 'ls'), null);
});
