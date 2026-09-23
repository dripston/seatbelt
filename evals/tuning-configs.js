'use strict';

// Three risky-command list configurations for Phase D sensitivity analysis.
// Each is expressed as glob-style patterns compatible with
// rule-guard.config.json's riskyCommands format (the SAME override
// mechanism scripts/risky-commands.js already supports), so testing these
// exercises the real code path, not a reimplementation of the matcher.

const STRICT = [
  'git *push*', // any git push variant, not just plain
  'git add*',
  'git commit*',
  'git merge*',
  'git rebase*',
  'git reset*',
  'git clean*',
  'git branch*',
  'git checkout*',
  'git tag*',
  'rm*',
  'sudo*',
  'vercel*',
  'firebase*',
  'kubectl*',
  'terraform*',
  'docker*',
  'npm publish*',
  'npm install*',
  'pip install*',
  'DROP*',
  'DELETE*',
  'TRUNCATE*',
];

const CURRENT = null; // null signals "use the shipped built-in list unmodified"

const LOOSE = [
  'git push*--force*',
  'git push*-f*',
  'git reset --hard*',
  'rm -rf*',
  'rm*-rf*',
  'git branch -D*',
  'vercel *--prod*',
  'firebase deploy*',
  'kubectl apply*',
  'terraform apply*',
];

module.exports = { STRICT, CURRENT, LOOSE };
