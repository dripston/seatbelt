'use strict';

// All four hook entrypoints (session-start.js, depth-check.js,
// guard-check.js, session-end.js) call an async main() bare at module
// scope, with a .catch() that forces process.exit(0) on any rejection.
// This guards against a real, reproducible bug: an async main() with NO
// .catch() crashes the process with a non-zero exit code and a stack
// trace on stderr if anything in it rejects after the fact — most
// plausibly process.stdout.write throwing on EPIPE if Claude Code closes
// the hook's pipe early (e.g. a timeout). Reproduced directly before the
// fix: a throwing stdout.write with a bare `main();` (no .catch) exits 1,
// not 0 — the opposite of the fail-open contract every hook here claims.
//
// Attempting to force a real OS-level EPIPE through spawnSync/spawn on
// this project's Windows/Git-Bash environment did not reliably
// reproduce the failure (Windows named-pipe/buffering behavior absorbs
// it in ways that made the test pass identically with or without the
// fix — a non-discriminating test is worse than no test, since it
// implies coverage that isn't there). Testing the actual invariant that
// changed instead: the `.catch(() => process.exit(0))` wiring pattern
// itself, in isolation, proven to convert ANY rejection into a clean
// exit rather than letting it propagate unhandled.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Mirrors the exact wiring added to each hook script's
// `if (require.main === module) { ... }` block.
function runMainFailOpen(main) {
  return new Promise((resolve) => {
    main().catch(() => resolve('exit-0'));
  });
}

test('a rejecting main() resolves to a clean outcome instead of propagating unhandled', async () => {
  async function throwingMain() {
    await Promise.resolve();
    throw new Error('simulated EPIPE from process.stdout.write');
  }
  const result = await runMainFailOpen(throwingMain);
  assert.equal(result, 'exit-0');
});

test('a resolving main() is unaffected by the .catch() wrapper', async () => {
  let ran = false;
  async function normalMain() {
    ran = true;
  }
  await new Promise((resolve) => {
    normalMain().then(resolve).catch(() => resolve('should not happen'));
  });
  assert.equal(ran, true);
});

// Static check on the real files: proves all four hook entrypoints
// actually have the .catch() wrapper wired up, not just that the pattern
// works in isolation above. A bare `main();` with no .catch() would pass
// every other test in this project (none of them exercise the
// require.main === module block), so this is the only thing that would
// catch a future hook script — or an edit to an existing one — that
// forgets to add it.
const HOOK_SCRIPTS = ['session-start.js', 'depth-check.js', 'guard-check.js', 'session-end.js'];

for (const script of HOOK_SCRIPTS) {
  test(`${script} wires main() through a .catch() before exiting, not a bare call`, () => {
    const filePath = path.join(__dirname, '..', 'scripts', script);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.match(
      content,
      /main\(\)\.catch\(/,
      `${script} should call main().catch(...) so an async rejection can't crash the process with a non-zero exit`
    );
  });
}
