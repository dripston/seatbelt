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
  main();
}
