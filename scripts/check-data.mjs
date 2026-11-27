#!/usr/bin/env node
// Check data/tracker.json for structural problems before the scout commits it.
// Read-only: prints problems and exits 1 if any are found. No network, no writes.
import { readFile } from 'node:fs/promises';

const file = new URL('../data/tracker.json', import.meta.url);
const data = JSON.parse(await readFile(file, 'utf8'));
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

check(Array.isArray(data.efforts), 'efforts must be an array');
check(Array.isArray(data.candidates), 'candidates must be an array');
check(Array.isArray(data.ignored), 'ignored must be an array');
check(Array.isArray(data.changes), 'changes must be an array');

const ids = new Set();
for (const e of data.efforts || []) {
  check(typeof e.id === 'string' && e.id.length > 0, `effort missing id: ${JSON.stringify(e.name)}`);
  // A repo is optional: efforts without public code use `byline` instead (see app.js hasRepo).
  if (e.repo != null) check(typeof e.repo === 'string' && e.repo.includes('/'), `effort has bad repo: ${e.id}`);
  check(typeof e.name === 'string' && e.name.length > 0, `effort missing name: ${e.id}`);
  check(!ids.has(e.id), `duplicate effort id: ${e.id}`);
  ids.add(e.id);
  check(['tracked', 'watchlist'].includes(e.tier), `effort ${e.id} has bad tier: ${e.tier}`);
  // groundwork is optional: an effort with no public code has none (see scoring.js groundworkFraction).
  check(e.gta && typeof e.gta === 'object', `effort ${e.id} missing gta`);
  for (const [k, v] of Object.entries(e.groundwork || {})) {
    check(typeof v === 'number' && v >= 0 && v <= 1, `effort ${e.id} groundwork.${k}=${v} out of range`);
  }
  for (const key of ['loads', 'boots', 'menu', 'world', 'playable', 'story', 'render']) {
    const v = e.gta?.[key];
    check(typeof v === 'number' && v >= 0 && v <= 1, `effort ${e.id} gta.${key}=${v} out of range`);
  }
  // Unknown keys are silently ignored by scoring.js LADDER, so they make progress bars wrong.
  // `ingame` was the old name; current efforts use `world`/`playable` (see scoring.js).
  const gtaKeys = ['loads', 'boots', 'menu', 'world', 'playable', 'story', 'render', 'fps', 'stability'];
  for (const key of Object.keys(e.gta || {})) {
    check(gtaKeys.includes(key), `effort ${e.id} has unknown gta key: ${key}`);
  }
  // The editor's "up to 3" is a soft preference; owner decisions in EDITOR.md legitimately keep more.
  for (const key of ['highlights', 'blockers']) {
    check(Array.isArray(e[key]), `effort ${e.id} ${key} must be an array`);
  }
}

for (const c of data.candidates || []) {
  check(typeof c.repo === 'string' && c.repo.includes('/'), `candidate has bad repo: ${JSON.stringify(c)}`);
}
for (const x of data.ignored || []) {
  check(typeof x.repo === 'string' && x.repo.includes('/'), `ignored has bad repo: ${JSON.stringify(x)}`);
}

if (problems.length) {
  console.error(`tracker.json: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`tracker.json OK: ${data.efforts.length} efforts, ${data.candidates.length} candidates, ${data.ignored.length} ignored`);
