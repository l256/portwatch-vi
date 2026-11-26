// Builds the crawlable parts of the site at deploy time from data/tracker.json: one page per news
// article, a news archive, an RSS feed, the sitemap and the IndexNow key file.
// Pure functions with no Node or DOM APIs, so the same code can be checked in a browser;
// scripts/build-site.mjs does the file I/O in GitHub Actions.

import { esc, NEWS_ID_RE, articlePath, coverHtml, newsTime, byNewest } from '../../assets/js/news-shared.js';

export const SITE_URL = 'https://portwatch-vi.xyz/';
const SITE_NAME = 'PortWatch VI';
const SOCIAL_IMAGE = `${SITE_URL}assets/img/social-miami.jpg`;
// IndexNow lets Bing, Yandex and others know a URL changed, without an account. The key is public by
// design: it's served as <key>.txt so the search engines can check the ping came from this site.
export const INDEXNOW_KEY = '0ab068a65fdde3463a6633b508a2fae0';

// Cloudflare Pages answers /x.html with a 308 to /x, so links that leave the site (canonical, sitemap,
// RSS, IndexNow) use the address without .html. The files themselves are still written as .html.
const articleUrl = (n) => `${SITE_URL}${articlePath(n).replace(/\.html$/, '')}`;
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const httpsOnly = (u) => (/^https:\/\/[^\s"'<>]+$/.test(u || '') ? u : null);
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Static pages can't know the reader's time zone, so a post's time is shown in UTC ("25 November 2026, 11:02 UTC").
const fmtWhen = (n) => {
  const at = newsTime(n);
  if (!at) return fmtDay(n.date);
  const d = new Date(at);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${fmtDay(at.slice(0, 10))}, ${hm} UTC`;
};
const whenTag = (n) => `<time datetime="${esc(newsTime(n) || n.date)}">${esc(fmtWhen(n))}</time>`;
const jsonLd = (o) => JSON.stringify(o, null, 1).replace(/</g, '\\u003c');
const isoTime = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const hashId = (s) => ([...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5) >>> 0).toString(36);

/** News entries that get a page: valid slug id, date and title; newest first; duplicate ids dropped. */
export function publishableNews(data) {
  const seen = new Set();
  return (data.news || [])
    .filter((n) => n && NEWS_ID_RE.test(n.id || '') && isDay(n.date) && n.title && !seen.has(n.id) && seen.add(n.id))
    .sort(byNewest);
}

const BRAND = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a5cff"/><stop offset=".55" stop-color="#ff2e7e"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs>
          <circle cx="16" cy="16" r="12" fill="none" stroke="#eceef3" stroke-width="5"/>
          <circle cx="16" cy="16" r="12" fill="none" stroke="url(#bm)" stroke-width="5" stroke-linecap="round" stroke-dasharray="52 76" transform="rotate(-90 16 16)"/>
        </svg>`;

// Article pages live in news/, so every site link is relative to the parent folder.
function shell({ title, description, canonical, ogType = 'website', image, imageIsSocial, head = '', main, track }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="robots" content="max-image-preview:large">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">${imageIsSocial ? `
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#ffffff">
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="PortWatch VI news" href="${SITE_URL}news/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/css/style.css">
  <script src="../assets/js/theme.js"></script>${head}
</head>
<body class="page-news">
  <header class="nav is-scrolled">
    <div class="wrap nav-inner">
      <a class="brand" href="../" aria-label="PortWatch VI home">
        ${BRAND}
        <span>PortWatch<b>VI</b></span>
      </a>
      <nav class="nav-links" aria-label="Sections">
        <a href="../#race">Race</a>
        <a href="./" class="is-current">News</a>
        <a href="../#method">Scoring</a>
      </nav>
    </div>
  </header>

  <main class="wrap page">
${main}
  </main>

  <footer class="footer">
    <div class="wrap footer-inner">
      <div>
        <a class="brand brand-sm" href="../"><span>PortWatch<b>VI</b></span></a>
        <p>Fan-made tracker. Not affiliated with or endorsed by Rockstar Games, Take-Two or Microsoft. Grand Theft Auto and related marks belong to their owners. No game files, keys or executables are hosted or linked here.</p>
      </div>
      <div class="footer-meta">
        <p><a href="../">Does GTA VI run on PC yet? See the live tracker.</a></p>
        <p><a href="feed.xml">News RSS feed</a></p>
      </div>
    </div>
  </footer>
  <script type="module">
    import { trackView } from '../assets/js/backend.js';
    trackView(${JSON.stringify(track)});
  </script>
</body>
</html>
`;
}

// Cover art sits under the photo, so a photo that fails to load (hotlink blocked, gone) shows the cover instead.
function media(n, cls = '') {
  const img = httpsOnly(n.image?.url);
  return `<div class="story-media page-media ${cls}">${coverHtml(n.category)}${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="story-cat">${esc(n.category)}</span></div>`;
}

const card = (n, small) => `
      <a class="story ${small ? 'is-small' : ''}" href="${esc(n.id)}.html">
        ${media(n)}
        <div class="story-body">
          ${whenTag(n)}
          <h3>${esc(n.title)}</h3>
          <p>${esc(n.dek)}</p>
        </div>
      </a>`;

function sourceItem(s) {
  const label = `${esc(s.outlet)}${s.title ? `: ${esc(s.title)}` : ''}`;
  if (/^#[\w-]+$/.test(s.url || '')) return `<li><a href="../${esc(s.url)}">${label}</a></li>`;
  const url = httpsOnly(s.url);
  return url ? `<li><a href="${esc(url)}" target="_blank" rel="noopener">${label}</a></li>` : `<li>${label}</li>`;
}

function articlePage(n, others) {
  const url = articleUrl(n);
  const img = httpsOnly(n.image?.url);
  const modified = isDay(n.updatedAt) ? n.updatedAt : newsTime(n) || n.date;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: String(n.title).slice(0, 110),
    description: n.dek || undefined,
    datePublished: newsTime(n) || n.date,
    dateModified: modified,
    image: [img || SOCIAL_IMAGE],
    articleSection: n.category || undefined,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    citation: (n.sources || []).map((s) => httpsOnly(s.url)).filter(Boolean),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
  };
  const credit = n.image?.credit && img
    ? `Image: ${httpsOnly(n.image.link) ? `<a href="${esc(httpsOnly(n.image.link))}" target="_blank" rel="noopener">${esc(n.image.credit)}</a>` : esc(n.image.credit)}. `
    : '';
  const byline = n.by === 'claude' ? 'Written automatically by Claude from the linked sources.'
    : n.by === 'report' ? 'Reported by PortWatch; not yet confirmed by a public source.'
    : 'Written by PortWatch from the linked sources.';
  const more = others.slice(0, 6);
  const main = `    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">PortWatch VI</a><span aria-hidden="true">/</span><a href="./">News</a></nav>
    <article class="reader reader-page">
      ${media(n)}
      <div class="reader-inner">
        <p class="meta">${esc(n.category)} · ${whenTag(n)}</p>
        <h1>${esc(n.title)}</h1>
        ${n.dek ? `<p class="dek">${esc(n.dek)}</p>` : ''}
        <div class="article">
          ${(n.body || []).map((p) => `<p>${esc(p)}</p>`).join('\n          ')}
        </div>
        <div class="sources">
          <h2>Sources</h2>
          <ul>${(n.sources || []).map(sourceItem).join('')}</ul>
          <p class="fine">${credit}${byline}</p>
        </div>
      </div>
    </article>
${more.length ? `    <section class="more-news" aria-labelledby="more-title">
      <h2 class="mini-title" id="more-title">More news</h2>
      <div class="news-list">${more.map((o) => card(o, true)).join('')}
      </div>
      <p><a class="more-link" href="./">All news</a> <a class="more-link" href="../">Live tracker</a></p>
    </section>` : ''}`;
  return shell({
    title: `${n.title} · ${SITE_NAME}`,
    description: n.dek || n.title,
    canonical: url,
    ogType: 'article',
    image: img || SOCIAL_IMAGE,
    imageIsSocial: !img,
    head: `
  <meta property="article:published_time" content="${esc(newsTime(n) || n.date)}">
  <meta property="article:modified_time" content="${modified}">
  <meta property="article:section" content="${esc(n.category)}">
  <script type="application/ld+json">${jsonLd(ld)}</script>`,
    main,
    track: `/news/${n.id}`,
  });
}

function archivePage(news) {
  const url = `${SITE_URL}news/`;
  const description = 'Every PortWatch VI story about the leaked GTA VI build and PC ports: takedowns, legal news, scams and real port milestones, with links to the original reporting.';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'PortWatch VI news',
    description,
    url,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    mainEntity: { '@type': 'ItemList', itemListElement: news.map((n, i) => ({ '@type': 'ListItem', position: i + 1, url: articleUrl(n) })) },
  };
  const main = `    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">PortWatch VI</a><span aria-hidden="true">/</span><span>News</span></nav>
    <div class="section-head">
      <div>
        <p class="kicker">What's happening</p>
        <h1 class="page-title">GTA VI on PC: the news</h1>
        <p class="sub">The moves that matter around the leak: takedowns, confirmed leaks, legal news and scams. Short summaries in our own words, with links to the original reporting.</p>
      </div>
      <a class="more-link" href="feed.xml">RSS feed</a>
    </div>
    <div class="archive">${news.map((n) => card(n, false)).join('') || '\n      <p class="empty">No stories yet.</p>'}
    </div>`;
  return shell({
    title: `GTA VI on PC news: leaks, takedowns and port progress · ${SITE_NAME}`,
    description,
    canonical: url,
    image: SOCIAL_IMAGE,
    imageIsSocial: true,
    head: `
  <script type="application/ld+json">${jsonLd(ld)}</script>`,
    main,
    track: '/news',
  });
}

function rssFeed(news, updated) {
  const items = news.slice(0, 30).map((n) => {
    const link = articleUrl(n);
    return `  <item>
    <title>${esc(n.title)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <pubDate>${new Date(newsTime(n) || `${n.date}T12:00:00Z`).toUTCString()}</pubDate>
    <category>${esc(n.category)}</category>
    <description>${esc(n.dek || '')}</description>
  </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>PortWatch VI news</title>
  <link>${SITE_URL}news/</link>
  <description>Takedowns, leaks, legal news, scams and real progress on running GTA VI on PC.</description>
  <language>en</language>
  <lastBuildDate>${new Date(updated || Date.now()).toUTCString()}</lastBuildDate>
  <atom:link href="${SITE_URL}news/feed.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}

function changesFeed(changes, updated) {
  const list = [...(changes || [])].filter((c) => c && isDay(c.date) && c.text).reverse().slice(0, 40);
  const items = list.map((c) => {
    const text = String(c.text);
    const cut = text.search(/[:.]\s/);
    const title = text.length <= 96 ? text : cut > 12 && cut <= 96 ? text.slice(0, cut) : `${text.slice(0, 93).trimEnd()}…`;
    const guid = `portwatch-vi-change-${c.date}-${c.kind || 'update'}-${hashId(text)}`;
    return `  <item>
    <title>${esc(title)}</title>
    <link>${SITE_URL}#changes</link>
    <guid isPermaLink="false">${esc(guid)}</guid>
    <pubDate>${new Date(`${c.date}T12:00:00Z`).toUTCString()}</pubDate>
    ${c.kind ? `<category>${esc(c.kind)}</category>\n    ` : ''}<description>${esc(text)}</description>
  </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>PortWatch VI changes</title>
  <link>${SITE_URL}#changes</link>
  <description>Milestone breakthroughs, score changes, new efforts and status updates tracked by PortWatch VI.</description>
  <language>en</language>
  <lastBuildDate>${new Date(updated || Date.now()).toUTCString()}</lastBuildDate>
  <atom:link href="${SITE_URL}changes.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}

function sitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${esc(e.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/**
 * @returns {{ files: Record<string, string>, entries: { loc: string, lastmod?: string }[] }}
 *   files: path (relative to the site folder) → content; entries: what's in the sitemap.
 */
export function buildSite(data) {
  const news = publishableNews(data);
  const updated = isoTime(data.updated);
  const entries = [
    { loc: SITE_URL, lastmod: updated || undefined },
    { loc: `${SITE_URL}news/`, lastmod: news[0]?.date },
    ...news.map((n) => ({ loc: articleUrl(n), lastmod: isDay(n.updatedAt) ? n.updatedAt : n.date })),
  ];
  const files = {
    'news/index.html': archivePage(news),
    'news/feed.xml': rssFeed(news, updated),
    'changes.xml': changesFeed(data.changes, updated),
    'sitemap.xml': sitemap(entries),
    [`${INDEXNOW_KEY}.txt`]: INDEXNOW_KEY,
  };
  for (const n of news) files[articlePath(n)] = articlePage(n, news.filter((o) => o !== n));
  return { files, entries };
}

/** URLs that are new or have a different lastmod than in the previously deployed sitemap (all of them if there was none). */
export function changedUrls(previousSitemap, entries) {
  if (!previousSitemap) return entries.map((e) => e.loc);
  const prev = new Map();
  for (const m of previousSitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) prev.set(m[1].trim(), (m[2] || '').trim());
  return entries.filter((e) => !prev.has(e.loc) || prev.get(e.loc) !== (e.lastmod || '')).map((e) => e.loc);
}

export function indexNowPayload(urls) {
  return { host: new URL(SITE_URL).host, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}${INDEXNOW_KEY}.txt`, urlList: urls };
}
