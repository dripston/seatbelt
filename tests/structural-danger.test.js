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
  splitMorphology,
  matchesFusedVerbPrefix,
  matchesPowerShellVerbNoun,
  verbFamily,
} = require('../scripts/lib/structural-danger');

// --- Signal A: destructive verb + target + reversibility gate ---
// Round 2: every call now passes headCommand as the second argument,
// since matchesDestructiveVerbAndTarget consults the reversibility axis
// (scripts/lib/assess-reversibility.js), which needs it for the
// shared-account-CLI check. A destructive verb alone is no longer
// sufficient — it must ALSO score high-consequence.

test('A: flux delete kustomization x matches (shared-account CLI)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('flux delete kustomization production-apps', 'flux').matched, true);
});
test('A: doctl databases delete x matches (shared-account CLI)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('doctl databases delete prod-postgres-cluster', 'doctl').matched, true);
});
test('A: rclone purge remote:x matches (remote reach)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rclone purge remote:production-backups', 'rclone').matched, true);
});
test('A: influx bucket delete x matches (prod target + action verb via reach)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('influx bucket delete --name prod-metrics', 'influx').matched, true);
});
test('A: git update-ref -d x does not match (drop-like verb "rm" not needed, "delete" style word not present but -d...)', () => {
  // git update-ref uses -d, not the word "delete" — this specific phrasing
  // is NOT expected to match signal A (no destructive-verb WORD present).
  // Documented here as a known miss for this signal alone; see if another
  // signal catches it in the combined evaluateStructuralDanger test below.
  assert.equal(matchesDestructiveVerbAndTarget('git update-ref -d refs/heads/release-2.3', 'git').matched, false);
});
test('A: linode-cli linodes delete x matches (shared-account CLI)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('linode-cli linodes delete 12345678', 'linode-cli').matched, true);
});
test('A: kubectl delete namespace x matches (already-covered tool, still structurally valid)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('kubectl delete namespace production', 'kubectl').matched, true);
});
test('A: does NOT match a bare verb with no target', () => {
  assert.equal(matchesDestructiveVerbAndTarget('git status', 'git').matched, false);
});
test('A: does NOT match "delete" appearing with nothing following it', () => {
  assert.equal(matchesDestructiveVerbAndTarget('echo delete', 'echo').matched, false);
});
test('A: does NOT match "npm uninstall left-pad" (project-local, re-derivable target -> low consequence via reversibility gate, not via removing the verb)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('npm uninstall left-pad', 'npm').matched, false);
});
test('A: round-2 fix — DOES match "brew uninstall --force x" (uninstall is back in the vocabulary; --force makes it high-consequence)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('brew uninstall --force postgresql@14', 'brew').matched, true);
});
test('A: does NOT match "git reset --help" (--help is not a real target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('git reset --help', 'git').matched, false);
});
test('A: does NOT match "rm --help" (--help is not a real target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rm --help', 'rm').matched, false);
});
test('A: does NOT match "rm important-file.txt" (bare rm with no -r/-f flag, low-risk, project-local-looking target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('rm important-file.txt', 'rm').matched, false);
});
test('A: round-2 — does NOT match "nix-collect-garbage -d" head command alone without a target word (documented: -d is not a word matched by the verb regex, this specific phrasing is a known remaining gap for signal A, covered instead by whichever signal fires for it, if any)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('nix-collect-garbage -d', 'nix-collect-garbage').matched, false);
});
test('A: round-2 — "collect-garbage" verb alone with an ambiguous target does NOT match (correct: reversibility gate requires a positive high-consequence signal, verb presence alone is not enough — this is the gate working as intended, not a gap)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('somecli collect-garbage --older-than 7d', 'somecli').matched, false);
});
test('A: round-2 — "collect-garbage" verb DOES match once a high-consequence signal is present (remote reach)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('somecli collect-garbage remote:store', 'somecli').matched, true);
});
test('A: round-2 — DOES match "forget" (separation family) with a suppressed-confirm flag', () => {
  assert.equal(matchesDestructiveVerbAndTarget('restic forget --prune --force', 'restic').matched, true);
});

// --- Signal B: destructive flags, any binary ---

test('B: --no-preserve-root matches', () => {
  assert.equal(matchesDestructiveFlags('rm -rf --no-preserve-root /', 'rm').matched, true);
});
test('B: git reset --hard matches', () => {
  assert.equal(matchesDestructiveFlags('git reset --hard HEAD~3', 'git').matched, true);
});
test('B: docker system prune -a --volumes matches via the generalized --all/-a + destructive-verb scope-widening check (round 2: no longer hardcodes docker/npm/git/helm)', () => {
  assert.equal(matchesDestructiveFlags('docker system prune -a --volumes', 'docker').matched, true);
});
test('B: round-2 — a bare --prune FLAG (not verb form) on any binary with a high-consequence target matches', () => {
  assert.equal(matchesDestructiveFlags('sometool sync --prune remote:backups', 'sometool').matched, true);
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

// --- Round 2, Phase 2: morphology (splitMorphology, matchesFusedVerbPrefix, matchesPowerShellVerbNoun) ---

test('morphology: splits camelCase', () => {
  assert.deepEqual(splitMorphology('eraseDisk'), ['erase', 'Disk']);
});
test('morphology: splits PascalCase', () => {
  assert.deepEqual(splitMorphology('RemoveItem'), ['Remove', 'Item']);
});
test('morphology: splits kebab-case', () => {
  assert.deepEqual(splitMorphology('collect-garbage'), ['collect', 'garbage']);
});
test('morphology: splits snake_case', () => {
  assert.deepEqual(splitMorphology('reset_git_repo'), ['reset', 'git', 'repo']);
});
test('morphology: handles a plain lowercase word (no split needed)', () => {
  assert.deepEqual(splitMorphology('delete'), ['delete']);
});
test('morphology: handles mixed kebab+camel', () => {
  assert.deepEqual(splitMorphology('force-DeleteAll'), ['force', 'Delete', 'All']);
});
test('morphology: non-string input returns empty array', () => {
  assert.deepEqual(splitMorphology(undefined), []);
});

test('fused prefix: deletelocalsnapshots matches "delete"', () => {
  assert.equal(matchesFusedVerbPrefix('deletelocalsnapshots'), 'delete');
});
test('fused prefix: erasedisk matches "erase"', () => {
  assert.equal(matchesFusedVerbPrefix('erasedisk'), 'erase');
});
test('fused prefix: does NOT match an unrelated word', () => {
  assert.equal(matchesFusedVerbPrefix('helloworld'), null);
});
test('fused prefix: does NOT match the verb alone with nothing appended', () => {
  assert.equal(matchesFusedVerbPrefix('delete'), null);
});
test('fused prefix: non-string input returns null', () => {
  assert.equal(matchesFusedVerbPrefix(undefined), null);
});

test('PowerShell verb-noun: Remove-Item matches "remove"', () => {
  assert.equal(matchesPowerShellVerbNoun('remove-item'), 'remove');
});
test('PowerShell verb-noun: Stop-Service matches "stop"', () => {
  assert.equal(matchesPowerShellVerbNoun('stop-service'), 'stop');
});
test('PowerShell verb-noun: Clear-Disk matches "clear"', () => {
  assert.equal(matchesPowerShellVerbNoun('clear-disk'), 'clear');
});
test('PowerShell verb-noun: does NOT match a non-destructive verb-noun cmdlet', () => {
  assert.equal(matchesPowerShellVerbNoun('get-process'), null);
});
test('PowerShell verb-noun: does NOT match a head command with no hyphen', () => {
  assert.equal(matchesPowerShellVerbNoun('npm'), null);
});
test('PowerShell verb-noun: does NOT match docker-compose (compose is not in the verb list)', () => {
  assert.equal(matchesPowerShellVerbNoun('docker-compose'), null);
});

test('verbFamily: classifies "delete" as removal', () => {
  assert.equal(verbFamily('delete'), 'removal');
});
test('verbFamily: classifies "forget" as separation', () => {
  assert.equal(verbFamily('forget'), 'separation');
});
test('verbFamily: classifies "gc" as reduction', () => {
  assert.equal(verbFamily('gc'), 'reduction');
});
test('verbFamily: returns null for an unrecognized word', () => {
  assert.equal(verbFamily('banana'), null);
});

// --- Round 2, Phase 2: end-to-end morphology/non-POSIX cases via matchesDestructiveVerbAndTarget ---

test('round-2: diskutil eraseDisk (camelCase verb in argument + bare device identifier target)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('diskutil eraseDisk APFS Untitled disk2', 'diskutil').matched, true);
});
test('round-2: PowerShell Remove-Item with -Force matches', () => {
  assert.equal(
    matchesDestructiveVerbAndTarget('Remove-Item -Path C:\\inetpub\\wwwroot -Recurse -Force', 'remove-item').matched,
    true
  );
});
test('round-2: fastlane colon-value force:true matches', () => {
  assert.equal(
    matchesDestructiveVerbAndTarget('fastlane run reset_git_repo skip_clean:false force:true', 'fastlane').matched,
    true
  );
});
test('round-2: does NOT match a PowerShell Get-* cmdlet (non-destructive verb)', () => {
  assert.equal(matchesDestructiveVerbAndTarget('Get-Process | Where-Object {$_.Name -eq \'x\'}', 'get-process').matched, false);
});
test('round-2: does NOT match a benign colon-value flag with no destructive verb present', () => {
  assert.equal(matchesDestructiveVerbAndTarget('somecli run build_app verbose:true', 'somecli').matched, false);
});
