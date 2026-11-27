#!/usr/bin/env node
// Daily scout: refreshes every tracked repo, searches GitHub / Hacker News / Reddit / X for new
// efforts, classifies them, optionally has Claude review changes, and rewrites data/tracker.json.
//
//   node scripts/scout.mjs             # full run, writes data/tracker.json
//   node scripts/scout.mjs --dry-run   # print the summary, don't write
//
// Env: GITHUB_TOKEN (recommended), ANTHROPIC_API_KEY (optional Claude review),
//      REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (optional), X_BEARER_TOKEN (optional).
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { runScout } from './lib/pipeline.mjs';

const file = new URL('../data/tracker.json', import.meta.url);
const dryRun = process.argv.includes('--dry-run');
const env = process.env;

const data = JSON.parse(await readFile(file, 'utf8'));

let assess = null;
if (env.ANTHROPIC_API_KEY) {
  const { makeAssessor } = await import('./lib/assess.mjs');
  assess = makeAssessor({ apiKey: env.ANTHROPIC_API_KEY });
  console.log('Claude review: on');
} else {
  console.log('Claude review: off (set ANTHROPIC_API_KEY to enable)');
}

const started = Date.now();
const { summary } = await runScout(data, { token: env.GITHUB_TOKEN, env, assess });

// News desk (needs ANTHROPIC_API_KEY): Claude searches the web and writes up anything meaningful.
// The scout runs every 3 hours; the news desk runs at most every 11 hours to keep costs down.
const newsDue = !data.scout.lastNewsRun || Date.now() - Date.parse(data.scout.lastNewsRun) > 11 * 36e5;
if (env.ANTHROPIC_API_KEY && newsDue) {
  data.scout.lastNewsRun = new Date().toISOString();
  console.log('Writing news…');
  try {
    const { writeNews } = await import('./lib/news.mjs');
    const today = new Date().toISOString().slice(0, 10);
    const fresh = await writeNews({ existing: data.news || [], today, apiKey: env.ANTHROPIC_API_KEY });
    if (fresh.length) {
      data.news = [...fresh, ...(data.news || [])].slice(0, 40);
      for (const n of fresh) data.changes.push({ date: today, kind: 'new', text: `News: ${n.title}`, at: new Date().toISOString() });
      data.changes = data.changes.slice(-80);
    }
    summary.news = fresh.length;
    data.scout.lastSummary = data.scout.lastSummary.replace(/\.$/, `, ${fresh.length} news ${fresh.length === 1 ? 'story' : 'stories'}.`);
    console.log(`  ${fresh.length} new article(s)`);
  } catch (err) {
    console.log(`  ! News desk failed: ${err.message}`);
  }
}
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s: ${data.scout.lastSummary}`);
console.log(JSON.stringify({ ...summary, mentions: undefined }, null, 2));

if (!dryRun) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log('Wrote data/tracker.json');
}

if (env.GITHUB_STEP_SUMMARY) {
  const recent = (data.changes || []).filter((c) => c.date === new Date().toISOString().slice(0, 10));
  await appendFile(env.GITHUB_STEP_SUMMARY, [
    '## Scout run',
    data.scout.lastSummary,
    '',
    recent.length ? recent.map((c) => `- ${c.text}`).join('\n') : '_No changes today._',
    summary.errors.length ? `\n<details><summary>${summary.errors.length} errors</summary>\n\n${summary.errors.map((e) => `- ${e}`).join('\n')}\n</details>` : '',
    '',
  ].join('\n'));
}
