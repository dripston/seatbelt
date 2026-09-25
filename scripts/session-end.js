#!/usr/bin/env node
'use strict';

const { clearState } = require('./lib/depth-state');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  try {
    const input = JSON.parse(raw);
    if (input && input.session_id) clearState(input.session_id);
  } catch (_err) {
    // best-effort cleanup only; never fail the session end
  }
  process.exit(0);
}

if (require.main === module) {
  // main() is async; an uncaught rejection here would otherwise crash the
  // process with a non-zero exit and a stack trace on stderr — the
  // opposite of the fail-open contract this hook is meant to guarantee
  // (SessionEnd cleanup is already best-effort by design). Swallow and
  // always exit 0 instead.
  main().catch(() => {
    try {
      process.exit(0);
    } catch (_err) {
      // even process.exit can theoretically throw in a torn-down process;
      // nothing more to do
    }
  });
}
