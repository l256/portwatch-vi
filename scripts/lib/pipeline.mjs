// The scout pipeline (runs every 3 hours). Pure data-in / data-out: the caller loads and saves tracker.json.
// Runs in Node (GitHub Actions) and in a browser (local testing).
import { scoreEffort, overall, isPrivateBuild } from '../../assets/js/scoring.js';
import * as core from './core.mjs';

const lc = (s) => String(s || '').toLowerCase();
// An effort with no public code has `repo: null`: there is nothing on GitHub to refresh, so the scout skips it.
const hasRepo = (e) => typeof e.repo === 'string' && e.repo.includes('/');
const CANDIDATE_MIN = 35; // substance needed to show up in "New candidates"
const MAX_CANDIDATES = 30;
const MAX_IGNORED = 2500;
const MAX_MEMBERS = 500;
const MAX_CHANGES = 80;
const MAX_ASSESS_PER_RUN = 12;

export async function runScout(data, opts = {}) {
  const {
    token,
    env = {},
    now = new Date(),
    log = console.log,
    assess = null, // optional async ({ meta, readme, commits, previous }) => assessment | null
    limit = Infinity, // cap repos refreshed (for local testing)
    sources = { github: true, hn: true, reddit: true, x: true },
    searchDelayMs = token ? 2200 : 6500,
  } = opts;

  const gh = core.makeGitHub({ token });
  const today = now.toISOString().slice(0, 10);
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const scout = (data.scout ||= {});
  const sinceDate = scout.since || '2026-11-19';
  const summary = { refreshed: 0, readmeChanged: 0, gone: 0, discovered: 0, newCandidates: 0, flagged: 0, assessed: 0, promoted: 0, errors: [], mentions: {} };
  const changes = (data.changes ||= []);
  const addChange = (kind, text, extra = {}) => changes.push({ date: today, kind, text, at: new Date().toISOString(), ...extra });
  const prevScores = new Map(data.efforts.map((e) => [e.id, scoreEffort(e).score]));
  const prevLeader = overall(data.efforts).leader?.effort?.id;
  const errorOut = (where, err) => {
    summary.errors.push(`${where}: ${err.message}`);
    log(`  ! ${where}: ${err.message}`);
    if (err instanceof core.RateLimitError) throw err;
  };

  /* 1. Refresh every tracked / watchlist effort */
  log('Refreshing tracked efforts…');
  const changedReadmes = [];
  const trackedText = new Map(); // repo -> README shingles, to catch re-uploads
  for (const e of data.efforts.filter(hasRepo).slice(0, limit)) {
    try {
      const meta = await gh.repo(e.repo);
      if (meta.missing) {
        if (!e.stats?.missing) {
          addChange('removed', `${e.name} is no longer reachable on GitHub (HTTP ${meta.status}${meta.status === 451 ? ', blocked' : ''}).`);
          summary.gone++;
        }
        e.stats = { ...(e.stats || {}), missing: true, missingStatus: meta.status };
        continue;
      }
      if (lc(meta.fullName) !== lc(e.repo)) {
        addChange('flag', `${e.name} moved to ${meta.fullName}.`);
        e.repo = meta.fullName;
      }
      const branch = e.branch || meta.defaultBranch;
      e.stats = {
        ...(e.stats || {}),
        stars: meta.stars, forks: meta.forks, openIssues: meta.openIssues,
        createdAt: meta.createdAt, pushedAt: meta.pushedAt, archived: meta.archived, missing: false,
        commits7d: await gh.commitsSince(e.repo, branch, since7),
      };
      const readme = await gh.readme(e.repo, branch);
      if (readme) {
        trackedText.set(e.repo, core.shingles(readme));
        const sha = await core.sha256(readme);
        if (e.readmeSha && sha !== e.readmeSha) {
          changedReadmes.push({ effort: e, readme, branch });
          e.readmeChangedAt = today;
          summary.readmeChanged++;
        }
        e.readmeSha = sha;
        const reached = scoreEffort(e).reached;
        const claims = core.detectClaims(readme, reached);
        const fresh = claims.filter((c) => !(e.claims || []).some((o) => o.text === c.text));
        for (const c of fresh) addChange('claim', `${e.name}'s README may claim a new milestone (${c.milestone}): “${c.text.slice(0, 120)}”`);
        e.claims = claims;
      }
      summary.refreshed++;
    } catch (err) { errorOut(e.repo, err); }
  }

  log('Refreshing toolkit…');
  for (const t of (data.tools || []).slice(0, limit)) {
    try {
      const meta = await gh.repo(t.repo);
      t.stats = meta.missing ? { ...(t.stats || {}), missing: true } : { stars: meta.stars, pushedAt: meta.pushedAt };
    } catch (err) { errorOut(t.repo, err); }
  }

  /* 2. Discover */
  const known = new Set([
    ...data.efforts.flatMap((e) => [e.repo, ...(e.related || [])]),
    ...(data.tools || []).map((t) => t.repo),
    ...(data.ignored || []).filter((i) => !i.auto).map((i) => i.repo),
    ...(data.candidates || []).map((c) => c.repo),
    ...(data.flagged || []).flatMap((f) => f.members || []),
  ].map(lc));
  const ignoredAuto = new Map((data.ignored || []).filter((i) => i.auto).map((i) => [lc(i.repo), i]));
  const found = new Map(); // lc(full) -> { meta?, sources:Set, links:[] }
  const note = (full, source, link, meta) => {
    const k = lc(full);
    if (!found.has(k)) found.set(k, { full, meta: null, sources: new Set(), links: [] });
    const f = found.get(k);
    f.sources.add(source);
    if (link && f.links.length < 3) f.links.push(link);
    if (meta) f.meta = meta;
  };
  const allSearchMetas = [];

  if (sources.github) {
    log('Searching GitHub…');
    const queries = [...(scout.queries || []), ...(scout.watchNames || []).map((n) => `${n} in:name`)];
    for (const q of queries) {
      try {
        const items = await gh.search(q.replaceAll('{since}', sinceDate));
        allSearchMetas.push(...items);
        for (const m of items) note(m.fullName, 'GitHub search', null, m);
      } catch (err) { errorOut(`search "${q}"`, err); }
      await core.sleep(searchDelayMs);
    }
  }

  const posts = [];
  if (sources.hn) {
    log('Searching Hacker News…');
    const sinceEpoch = Math.floor(Date.parse(`${sinceDate}T00:00:00Z`) / 1000);
    for (const q of scout.hn || []) {
      try { posts.push(...(await core.hnSearch(q, sinceEpoch))); } catch (err) { errorOut(`HN "${q}"`, err); }
    }
  }
  // Reddit blocks anonymous API and RSS access, so it's only searched with approved app keys.
  if (sources.reddit && scout.reddit && env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    log('Searching Reddit…');
    let rtoken = null;
    try { rtoken = await core.redditToken(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET); } catch (err) { errorOut('Reddit auth', err); }
    const pairs = [
      ...(scout.reddit.subreddits || []).map((s) => ({ subreddit: s, query: 'github' })),
      ...(scout.reddit.queries || []).map((q) => ({ subreddit: null, query: q })),
    ];
    for (const p of pairs) {
      try { posts.push(...(await core.redditSearch({ ...p, token: rtoken }))); } catch (err) { errorOut(`Reddit ${p.subreddit || p.query}`, err); break; }
    }
  }
  if (sources.chan !== false) {
    const boards = scout.chan?.boards || ['v', 'vg'];
    log(`Scanning 4chan (${boards.map((b) => `/${b}/`).join(', ')})…`);
    for (const b of boards) {
      try { posts.push(...(await core.fourchanSearch(b))); } catch (err) { errorOut(`4chan /${b}/`, err); }
    }
  }
  if (sources.social !== false) {
    log('Searching Bluesky, Mastodon and Lemmy…');
    for (const q of scout.bluesky || ['gta 6 emulator', 'gta 6 recomp', 'gta vi pc port', 'xbox series emulator', 'leonida gta']) {
      try { posts.push(...(await core.blueskySearch(q))); } catch (err) { errorOut(`Bluesky "${q}"`, err); break; }
    }
    for (const tag of scout.mastodon || ['gta6', 'gtavi', 'emulation', 'reverseengineering']) {
      try { posts.push(...(await core.mastodonTag(tag))); } catch (err) { errorOut(`Mastodon #${tag}`, err); }
    }
    for (const q of scout.lemmy || ['gta 6 pc', 'gta 6 emulator', 'xbox series emulator']) {
      try { posts.push(...(await core.lemmySearch(q))); } catch (err) { errorOut(`Lemmy "${q}"`, err); break; }
    }
  }
  if (sources.x && env.X_BEARER_TOKEN && scout.x) {
    log('Searching X…');
    try { posts.push(...(await core.xSearch(scout.x, env.X_BEARER_TOKEN))); } catch (err) { errorOut('X', err); }
  }
  for (const p of posts) {
    for (const full of core.extractGithubRepos(p.text)) {
      note(full, p.source, p.link);
      summary.mentions[lc(full)] = (summary.mentions[lc(full)] || 0) + 1;
    }
  }
  // Social mentions of tracked efforts
  for (const e of data.efforts) {
    const n = summary.mentions[lc(e.repo)];
    if (n) e.stats = { ...(e.stats || {}), mentions7d: n };
  }

  /* 3. Classify anything new */
  // Count repos, not search hits: one repo often turns up in several searches.
  const byDesc = new Map(); // description -> repo -> created at
  for (const m of allSearchMetas) {
    const d = core.normDesc(m.description);
    if (d.length <= 25) continue;
    if (!byDesc.has(d)) byDesc.set(d, new Map());
    byDesc.get(d).set(lc(m.fullName), m.createdAt);
  }
  const descCounts = new Map([...byDesc].map(([d, repos]) => [d, repos.size]));
  // The oldest repo with a description is the one being copied, so its description never counts against it.
  const originals = new Set([...byDesc.values()].map((repos) => [...repos].sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))[0][0]));
  const fresh = [...found.values()].filter((f) => !known.has(lc(f.full)));
  log(`Classifying ${fresh.length} unknown repos…`);
  data.candidates ||= [];
  data.ignored ||= [];
  data.flagged ||= [];

  // Rules that keep copies and junk out of the public candidate list.
  const trackedByName = new Map(
    [...data.efforts.flatMap((e) => [e.repo, ...(e.related || [])]), ...(data.tools || []).map((t) => t.repo)]
      .filter((r) => typeof r === 'string' && r.includes('/'))
      .map((r) => [lc(r.split('/')[1]), r]),
  );
  const ownersByName = new Map(); // repo name -> owners seen among new finds (clone networks)
  for (const full of [...fresh.map((f) => f.full), ...data.candidates.map((c) => c.repo)]) {
    const [owner, name] = full.split('/');
    if (trackedByName.has(lc(name))) continue;
    if (!ownersByName.has(lc(name))) ownersByName.set(lc(name), new Set());
    ownersByName.get(lc(name)).add(lc(owner));
  }
  const flagInto = (id, pattern, reason, full) => {
    let cluster = data.flagged.find((c) => c.id === id);
    if (!cluster) { cluster = { id, pattern, label: '', count: 0, reason, members: [] }; data.flagged.push(cluster); }
    if (cluster.members.some((m) => lc(m) === lc(full))) return;
    if (cluster.members.length < MAX_MEMBERS) cluster.members.push(full);
    cluster.count = (cluster.count || 0) + 1;
    summary.flagged++;
  };
  const flagCopy = (full, of, pct) => {
    flagInto('copies', 'Re-uploads of tracked projects under other accounts',
      'Copies can be quietly modified to bundle malware. Only use the original repositories linked in the race above.', full);
    data.ignored = data.ignored.filter((i) => lc(i.repo) !== lc(full));
    data.ignored.push({ repo: full, reason: `copy of ${of}${pct ? ` (${pct}% same README)` : ''}`, seenAt: today });
    summary.copies = (summary.copies || 0) + 1;
  };
  // Returns why a repo must not be a candidate, or null if it passes.
  const screen = (meta, readme) => {
    const name = meta.fullName.split('/')[1];
    const sh = core.shingles(readme);
    const empty = String(readme).trim().length < 400;
    // Same name as a tracked project: a copy if the README matches it or there's barely a README.
    // (A different project that merely shares a generic name passes.)
    const sameName = trackedByName.get(lc(name));
    if (sameName && lc(sameName) !== lc(meta.fullName)) {
      const ts = trackedText.get(sameName);
      const o = ts ? core.overlap(sh, ts) : 1;
      if (o >= 0.3 || empty) return { copyOf: sameName, pct: ts ? Math.round(o * 100) : 0 };
    }
    for (const [repo, ts] of trackedText) {
      const o = core.overlap(sh, ts);
      if (o >= 0.6 && lc(repo) !== lc(meta.fullName)) return { copyOf: repo, pct: Math.round(o * 100) };
    }
    if (core.isFanGame(meta, readme)) return { ignore: 'off-topic (original fan game, not a port)' };
    // Unrelated projects can share a generic name, so a shared name marks a clone only without real code and substance.
    // (A wordy landing page can score as substance, hence the code check. Candidates keep the score they got in on.)
    if ((ownersByName.get(lc(name))?.size || 0) >= 3) {
      const hasCode = meta.language && meta.language !== 'HTML';
      if (!hasCode || (meta.substance ?? core.substance(meta, readme).score) < CANDIDATE_MIN) return { clone: true };
    }
    if (name === '.github') return { ignore: 'organization profile, not a project' };
    if (empty) return { ignore: 'no real README' };
    if (!core.isRelevant(meta, readme)) return { ignore: 'off-topic (not about GTA VI or Xbox Series)' };
    return null;
  };
  const applyScreen = (meta, verdict) => {
    if (verdict.copyOf) flagCopy(meta.fullName, verdict.copyOf, verdict.pct);
    else if (verdict.clone) flagInto('auto-clone-networks', 'Networks of cloned repos', 'The same repo name under three or more new accounts. Flagged automatically by the scout.', meta.fullName);
    else pushIgnored(data, meta, verdict.ignore, today);
  };

  // Re-screen candidates already waiting for review, so older finds get the same rules.
  for (const c of [...data.candidates]) {
    if (c.status !== 'new' || c.host === 'gitlab') continue;
    try {
      const readme = (await gh.readme(c.repo, c.defaultBranch)) || '';
      const verdict = screen({ fullName: c.repo, description: c.description, pushedAt: c.pushedAt, language: c.language, substance: c.substance }, readme);
      if (verdict) {
        data.candidates = data.candidates.filter((x) => x !== c);
        applyScreen({ fullName: c.repo, pushedAt: c.pushedAt }, verdict);
        log(`  - removed candidate ${c.repo}: ${verdict.copyOf ? `copy of ${verdict.copyOf}` : verdict.clone ? 'clone network' : verdict.ignore}`);
      }
    } catch (err) { errorOut(`screen ${c.repo}`, err); }
  }

  for (const f of fresh.slice(0, limit)) {
    try {
      const prevIgnored = ignoredAuto.get(lc(f.full));
      let meta = f.meta;
      if (!meta) {
        meta = await gh.repo(f.full);
        if (meta.missing) continue;
      }
      // Re-check an auto-ignored repo only if it has been pushed since we last looked, at most weekly.
      if (prevIgnored && (Date.parse(meta.pushedAt) <= Date.parse(prevIgnored.pushedAt || 0) || (now - Date.parse(prevIgnored.seenAt || 0)) < 7 * 864e5)) continue;

      const spam = core.spamCheck(meta, originals.has(lc(meta.fullName)) ? new Map() : descCounts);
      if (spam) {
        let cluster = data.flagged.find((c) => c.id === spam.cluster);
        if (!cluster) {
          cluster = { id: spam.cluster, pattern: spam.cluster === 'auto-download-lures' ? 'Repos promising downloads or installers' : spam.cluster === 'auto-clone-networks' ? 'Networks of cloned repos' : spam.cluster, label: '', count: 0, reason: spam.reason + '. Flagged automatically by the scout.', members: [] };
          data.flagged.push(cluster);
        }
        if (cluster.members.length < MAX_MEMBERS) cluster.members.push(meta.fullName);
        cluster.count = (cluster.count || 0) + 1;
        summary.flagged++;
        continue;
      }
      if (meta.fork && meta.stars < 10) { pushIgnored(data, meta, 'fork', today); continue; }

      const readme = (await gh.readme(meta.fullName, meta.defaultBranch)) || '';
      summary.discovered++;
      const verdict = screen(meta, readme);
      if (verdict) { applyScreen(meta, verdict); continue; }
      const commits7d = await gh.commitsSince(meta.fullName, meta.defaultBranch, since7);
      const sub = core.substance(meta, readme, commits7d);
      if (!sub.relevant) { pushIgnored(data, meta, 'off-topic', today); continue; }
      if (sub.score < CANDIDATE_MIN) { pushIgnored(data, meta, `thin (substance ${sub.score})`, today); continue; }

      data.ignored = data.ignored.filter((i) => lc(i.repo) !== lc(meta.fullName));
      data.candidates.push({
        repo: meta.fullName,
        name: meta.name,
        description: meta.description,
        language: meta.language,
        stars: meta.stars,
        createdAt: meta.createdAt,
        pushedAt: meta.pushedAt,
        defaultBranch: meta.defaultBranch,
        sources: [...f.sources],
        links: f.links,
        foundAt: now.toISOString(),
        substance: sub.score,
        signals: sub.signals,
        kind: sub.kind,
        status: 'new',
      });
      addChange('new', `Scout spotted ${meta.fullName} (${sub.kind === 'tool' ? 'tool' : 'possible effort'}, substance ${sub.score}).`);
      summary.newCandidates++;
    } catch (err) { errorOut(`classify ${f.full}`, err); }
  }
  // GitLab: projects that may have moved off GitHub (e.g. after a takedown).
  if (sources.gitlab !== false) {
    log('Searching GitLab…');
    const sinceIso = `${sinceDate}T00:00:00Z`;
    for (const q of scout.gitlab || ['gta vi', 'gta6', 'xbox series emulator', 'scarlett xbox', 'rpf9', 'leonida']) {
      try {
        for (const g of await core.gitlabSearch(q, sinceIso)) {
          const key = lc(`gitlab.com/${g.fullName}`);
          if (known.has(key) || data.candidates.some((c) => lc(c.repo) === key) || data.ignored.some((i) => lc(i.repo) === key)) continue;
          known.add(key);
          const readme = await core.gitlabReadme(g);
          const meta = { ...g, language: null, size: 0 };
          const verdict = screen({ ...meta, fullName: `gitlab.com/${g.fullName}` }, readme);
          const sub = core.substance(meta, readme, null);
          if (verdict || !sub.relevant || sub.score < CANDIDATE_MIN) {
            data.ignored.push({ repo: `gitlab.com/${g.fullName}`, reason: verdict?.ignore || (verdict?.copyOf ? `copy of ${verdict.copyOf}` : !sub.relevant ? 'off-topic' : `thin (substance ${sub.score})`), auto: true, seenAt: today, pushedAt: g.pushedAt });
            continue;
          }
          data.candidates.push({ repo: `gitlab.com/${g.fullName}`, host: 'gitlab', name: g.name, description: g.description, stars: g.stars, createdAt: g.createdAt, pushedAt: g.pushedAt, sources: ['GitLab search'], links: [], foundAt: now.toISOString(), substance: sub.score, signals: sub.signals, kind: sub.kind, status: 'new' });
          addChange('new', `Scout spotted gitlab.com/${g.fullName} (substance ${sub.score}).`);
          summary.newCandidates++;
        }
      } catch (err) { errorOut(`GitLab "${q}"`, err); }
    }
  }

  // Headlines from news feeds (no AI needed): only stories about the leak, ports, takedowns, scams or official news.
  if (sources.news !== false) {
    log('Reading news feeds…');
    const qs = scout.newsQueries || ['GTA 6 leak', 'GTA 6 PC', 'GTA 6 emulator', 'Take-Two DMCA', 'Cyberleek'];
    const fresh = [];
    for (const q of qs) {
      const enc = encodeURIComponent(q);
      for (const [url, name] of [[`https://news.google.com/rss/search?q=${enc}+when:7d&hl=en-US&gl=US&ceid=US:en`, 'Google News'], [`https://www.bing.com/news/search?q=${enc}&format=rss`, 'Bing News']]) {
        try { fresh.push(...(await core.newsFeed(url, name)).filter(core.isLeakHeadline)); } catch (err) { errorOut(`${name} "${q}"`, err); }
      }
    }
    const norm = (t) => lc(t).replace(/[^a-z0-9]+/g, ' ').trim();
    const seen = new Set();
    data.headlines = [...fresh, ...(data.headlines || [])]
      .filter((h) => (now - Date.parse(h.date)) < 14 * 864e5)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .filter((h) => { const k = norm(h.title).slice(0, 70); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 30);
  }

  // DMCA watch: new Take-Two / Rockstar notices in GitHub's public DMCA log.
  if (sources.dmca !== false) {
    log('Checking GitHub DMCA notices…');
    try {
      const since = scout.lastDmcaCheck || new Date(now - 7 * 864e5).toISOString();
      const notices = await core.dmcaNotices(gh, since, token);
      data.dmca ||= [];
      for (const n of notices) {
        if (data.dmca.some((d) => d.path === n.path)) continue;
        const named = data.efforts.filter((e) => n.repos.some((r) => lc(r) === lc(e.repo)));
        data.dmca.unshift({ path: n.path, url: n.url, date: n.date, repoCount: n.repos.length, gta6: n.gta6, tracked: named.map((e) => e.id) });
        for (const e of named) {
          e.stats = { ...(e.stats || {}), dmca: { date: n.date, url: n.url } };
          addChange('flag', `${e.name} is named in a new DMCA notice (${n.date}).`);
        }
        if (n.gta6 || named.length) {
          addChange('flag', `New ${/rockstar/i.test(n.path) ? 'Rockstar' : 'Take-Two'} DMCA notice on GitHub (${n.repos.length} repos${n.gta6 ? ', mentions GTA VI' : ''}).`);
          data.headlines = [{ title: `New ${/rockstar/i.test(n.path) ? 'Rockstar' : 'Take-Two'} DMCA notice filed on GitHub (${n.repos.length} repositories)`, outlet: 'GitHub DMCA log', link: n.url, date: `${n.date}T12:00:00.000Z`, via: 'DMCA watch' }, ...(data.headlines || [])].slice(0, 30);
        }
      }
      data.dmca = data.dmca.slice(0, 40);
      scout.lastDmcaCheck = now.toISOString();
    } catch (err) { errorOut('DMCA watch', err); }
  }

  // Refresh candidate stats and keep the best ones.
  for (const c of data.candidates.slice(0, limit)) {
    if (c.status !== 'new' || c.host === 'gitlab' || found.has(lc(c.repo))) continue;
    try {
      const m = await gh.repo(c.repo);
      if (m.missing) { c.status = 'rejected'; c.rejectReason = 'gone'; continue; }
      Object.assign(c, { stars: m.stars, pushedAt: m.pushedAt, description: m.description });
    } catch (err) { errorOut(`candidate ${c.repo}`, err); }
  }
  data.candidates = data.candidates
    .filter((c) => c.status !== 'rejected')
    .sort((a, b) => b.substance - a.substance)
    .slice(0, MAX_CANDIDATES);

  /* 4. Optional: Claude reviews changed READMEs and new candidates */
  if (assess) {
    log('Assessing with Claude…');
    let budget = MAX_ASSESS_PER_RUN;
    for (const { effort, readme, branch } of changedReadmes) {
      if (budget-- <= 0) break;
      try {
        const commits = await gh.recentCommits(effort.repo, branch);
        const a = await assess({ meta: { fullName: effort.repo, ...effort.stats }, readme, commits, previous: publicView(effort) });
        if (!a) continue;
        applyAssessment(effort, a, today);
        summary.assessed++;
      } catch (err) { errorOut(`assess ${effort.repo}`, err); }
    }
    for (const c of [...data.candidates]) {
      if (budget-- <= 0) break;
      if (c.status !== 'new' || c.host === 'gitlab' || (c.kind === 'tool' && c.substance < 50)) continue;
      try {
        const readme = (await gh.readme(c.repo, c.defaultBranch)) || '';
        const commits = await gh.recentCommits(c.repo, c.defaultBranch);
        const a = await assess({ meta: { fullName: c.repo, stars: c.stars, createdAt: c.createdAt, pushedAt: c.pushedAt, language: c.language }, readme, commits, previous: null });
        summary.assessed++;
        if (!a) continue;
        data.candidates = data.candidates.filter((x) => x !== c);
        if (a.verdict === 'tracked' || a.verdict === 'watchlist') {
          const e = newEffortFrom(c, a, today);
          while (data.efforts.some((x) => x.id === e.id)) e.id += '-2';
          e.readmeSha = await core.sha256(readme);
          data.efforts.push(e);
          addChange('new', `${e.name} added to the ${a.verdict === 'tracked' ? 'race' : 'watchlist'}: ${a.summary.slice(0, 140)}`);
          summary.promoted++;
        } else if (a.verdict === 'tool') {
          data.tools.push({ repo: c.repo, name: a.name || c.name, kind: a.approach || 'Tool', desc: a.summary.slice(0, 160), stats: { stars: c.stars, pushedAt: c.pushedAt } });
          addChange('new', `${a.name || c.name} added to the toolkit.`);
          summary.promoted++;
        } else if (a.verdict === 'flag') {
          let cluster = data.flagged.find((x) => x.id === 'auto-reviewed');
          if (!cluster) { cluster = { id: 'auto-reviewed', pattern: 'Repos judged misleading on review', label: '', count: 0, reason: 'Reviewed by the scout and judged fake, misleading or unsafe.', members: [] }; data.flagged.push(cluster); }
          cluster.members.push(c.repo);
          cluster.count++;
        } else {
          pushIgnored(data, { fullName: c.repo, pushedAt: c.pushedAt }, `reviewed: ${a.reasoning.slice(0, 80)}`, today);
        }
      } catch (err) { errorOut(`assess ${c.repo}`, err); }
    }
  }

  /* 5. Change feed, history, bookkeeping */
  for (const e of data.efforts) {
    const before = prevScores.get(e.id);
    const after = scoreEffort(e).score;
    if (before == null || isPrivateBuild(e)) continue; // private builds show a stage, not a score
    const delta = Math.round((after - before) * 10) / 10;
    if (Math.abs(delta) >= 0.5) addChange(delta > 0 ? 'up' : 'down', `${e.name} ${delta > 0 ? 'rose' : 'fell'} ${Math.abs(delta)} pts to ${after}%.`);
  }
  const ov = overall(data.efforts.filter((e) => !e.stats?.missing));
  if (ov.leader && prevLeader && ov.leader.effort.id !== prevLeader) addChange('up', `${ov.leader.effort.name} takes the lead at ${ov.leader.score}%.`);
  data.history ||= [];
  const point = { date: today, leader: ov.score, leaderId: ov.leader?.effort.id || null, top3: ov.top3, furthest: ov.furthest.key, tracked: data.efforts.length };
  const idx = data.history.findIndex((h) => h.date === today);
  if (idx >= 0) data.history[idx] = point; else data.history.push(point);
  data.changes = changes.slice(-MAX_CHANGES);
  if (data.ignored.length > MAX_IGNORED) data.ignored = [...data.ignored.filter((i) => !i.auto), ...data.ignored.filter((i) => i.auto).slice(-MAX_IGNORED)];

  data.updated = now.toISOString();
  scout.lastRun = now.toISOString();
  scout.lastSummary = `${summary.refreshed} refreshed, ${summary.readmeChanged} READMEs changed, ${summary.newCandidates} new candidates, ${summary.flagged} flagged${assess ? `, ${summary.assessed} reviewed by Claude` : ''}${summary.errors.length ? `, ${summary.errors.length} errors` : ''}.`;
  summary.githubCalls = gh.calls;
  return { data, summary };
}

function pushIgnored(data, meta, reason, today) {
  data.ignored = data.ignored.filter((i) => lc(i.repo) !== lc(meta.fullName));
  data.ignored.push({ repo: meta.fullName, reason, auto: true, seenAt: today, pushedAt: meta.pushedAt });
}

// What we show the model as "the current assessment" (no stats noise).
function publicView(e) {
  const { name, approach, target, tier, summary, highlights, blockers, groundwork, gta, provenOn, verification } = e;
  return { name, approach, target, tier, summary, highlights, blockers, groundwork, gta, provenOn, verification };
}

function applyAssessment(e, a, today) {
  Object.assign(e, {
    approach: a.approach || e.approach,
    target: a.target || e.target,
    summary: a.summary || e.summary,
    highlights: a.highlights.length ? a.highlights : e.highlights,
    blockers: a.blockers.length ? a.blockers : e.blockers,
    groundwork: a.groundwork,
    gta: a.gta,
    provenOn: a.proven_on || null,
    assessedAt: today,
    assessedBy: 'claude',
  });
  if (a.verdict === 'tracked' || a.verdict === 'watchlist') e.tier = a.verdict;
}

function newEffortFrom(c, a, today) {
  const id = lc(c.repo.split('/')[1]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effort';
  return {
    id,
    name: a.name || c.name,
    repo: c.repo,
    branch: c.defaultBranch || 'main',
    tier: a.verdict,
    approach: a.approach,
    target: a.target,
    summary: a.summary,
    highlights: a.highlights,
    blockers: a.blockers,
    groundwork: a.groundwork,
    provenOn: a.proven_on || null,
    gta: a.gta,
    verification: 'self-reported',
    stats: { stars: c.stars, createdAt: c.createdAt, pushedAt: c.pushedAt, commits7d: null },
    assessedAt: today,
    assessedBy: 'claude',
  };
}
