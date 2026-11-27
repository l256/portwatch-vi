import { MILESTONES, GROUNDWORK, STABILITY, TRACKS, scoreEffort, overall, ladderValue, byStars, isPrivateBuild, trackStep, stabilityKey } from './scoring.js';
import { getLiveViewers, trackView } from './backend.js';
import { coverHtml, articlePath, newsTime, byNewest } from './news-shared.js';
import { fillPinned } from './pinned.js';
import { initI18n, t, tr, locale } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Everything rendered comes from data/tracker.json, part of which is written by an
// automated scout reading untrusted repos, so every string is escaped.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repoUrl = (repo, branch) => (REPO_RE.test(repo || '') ? `https://github.com/${repo}${branch && branch !== 'main' && branch !== 'master' ? `/tree/${encodeURIComponent(branch)}` : ''}` : '#');
const owner = (repo) => (repo || '').split('/')[0];
const avatar = (repo) => (REPO_RE.test(repo || '') ? `https://github.com/${encodeURIComponent(owner(repo))}.png?size=88` : '');
// Efforts with no public code have `repo: null`. They may give a local `avatar` image and a `link` to our own article.
// An effort may set `home` to its own repository URL when the code does not live on GitHub (e.g. it moved
// to a self-hosted forge); `repo` then keeps feeding the scout and the stats while `home` is the linked home.
const hasRepo = (e) => REPO_RE.test(e.repo || '');
const homeUrl = (e) => (/^https:\/\/[^\s<>"']+$/.test(e.home || '') ? e.home : '');
const effortAvatar = (e) => (/^assets\/img\/[\w/.-]+$/.test(e.avatar || '') ? e.avatar : avatar(e.repo));
const effortUrl = (e) => (homeUrl(e) || (hasRepo(e) ? repoUrl(e.repo, e.branch) : /^news\/[a-z0-9-]+\.html$/.test(e.link || '') ? e.link : ''));
const safeHttp = (u) => (/^https:\/\//.test(u || '') ? u : '#');
const pct = (v) => `${Math.round(v * 10) / 10}`;

// Names from scoring.js, in the page's language when a translation exists.
const msLabel = (key) => tr(`ms.${key}.label`, MILESTONES.find((m) => m.key === key)?.label || key);
const msDesc = (m) => tr(`ms.${m.key}.desc`, m.desc);
const gwLabel = (g) => tr(`gw.${g.key}.label`, g.label);
const gwDesc = (g) => tr(`gw.${g.key}.desc`, g.desc);
const stabLabel = (key) => tr(`stab.${key}`, (STABILITY[key] || STABILITY.unknown).label);
const catLabel = (cat) => tr(`cat.${cat}`, cat);
const trackLabel = (tk) => tr(`track.${tk.key}.label`, tk.label);
const trackDesc = (tk) => tr(`track.${tk.key}.desc`, tk.desc);
const stepLabel = (key, step) => tr(`track.${key}.step.${step.v}`, step.label);
// README claims name a milestone or a track; older ones use the previous scale's keys.
const OLD_CLAIM = { ingame: 'playable', fps30: 'perf', stable: 'stability' };
const claimLabel = (key) => {
  const k = OLD_CLAIM[key] || key;
  const tk = TRACKS.find((x) => x.key === k);
  return tk ? trackLabel(tk) : MILESTONES.some((m) => m.key === k) ? msLabel(k) : k;
};

function ago(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('time.justNow');
  const m = s / 60;
  if (m < 60) return t('time.minutes', { n: Math.round(m) });
  const h = m / 60;
  if (h < 24) return t('time.hours', { n: Math.round(h) });
  const d = h / 24;
  if (d < 30) return t('time.days', { n: Math.round(d) });
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
const daysSince = (iso) => (Date.now() - Date.parse(iso)) / 864e5;
const fmtK = (n) => (n == null ? '-' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

const ICON = {
  // Radiation trefoil: three 60-degree blades around a dot.
  nuke: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M17.25 21.09A10.5 10.5 0 0 1 6.75 21.09L10.4 14.77A3.2 3.2 0 0 0 13.6 14.77Z"/><path d="M1.5 12A10.5 10.5 0 0 1 6.75 2.91L10.4 9.23A3.2 3.2 0 0 0 8.8 12Z"/><path d="M17.25 2.91A10.5 10.5 0 0 1 22.5 12L15.2 12A3.2 3.2 0 0 0 13.6 9.23Z"/></svg>',
  star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .8l2.2 4.6 5 .7-3.6 3.5.9 5L8 12.2 3.5 14.6l.9-5L.8 6.1l5-.7z"/></svg>',
  fork: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 3.3a1.8 1.8 0 1 0-2.3 1.7v.8A2.5 2.5 0 0 0 5.2 8.3h1.9v2.7a1.8 1.8 0 1 0 1.8 0V8.3h1.9a2.5 2.5 0 0 0 2.5-2.5V5a1.8 1.8 0 1 0-1.5 0v.8a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V5A1.8 1.8 0 0 0 5 3.3Z"/></svg>',
  issue: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>',
  commit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 5a3 3 0 0 1 2.9 2.2H15v1.6h-4.1a3 3 0 0 1-5.8 0H1V7.2h4.1A3 3 0 0 1 8 5Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  gh: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0Z"/></svg>',
  // Arrow leaving a box: a repository hosted outside GitHub.
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>',
};

const state = { data: null, filter: 'all', sort: 'score' };

async function main() {
  // The pinned message is optional: it loads alongside and never holds up or breaks the page.
  const pinned = fetch(`data/pinned.json?ts=${Math.floor(Date.now() / 6e4)}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // Translations load alongside the data; initI18n never throws and falls back to English.
  const [res] = await Promise.all([
    fetch(`data/tracker.json?ts=${Math.floor(Date.now() / 6e4)}`, { cache: 'no-cache' }),
    initI18n(),
  ]);
  const data = await res.json();
  state.data = data;
  for (const e of data.efforts) Object.assign(e, { _s: scoreEffort(e) });

  renderMeta(data);
  renderHeroArt(data.site || {});
  startCountdown(data.exe || {});
  pinned.then((p) => fillPinned($('#pinned'), p, { ago, when: (iso) => new Date(iso).toLocaleString(locale()) }));
  renderOverall(data);
  renderChanges(data.changes || []);
  renderFilterChips();
  renderRace();
  renderNews(data.news || []);
  renderWatchlist(data);
  renderTools(data.tools || []);
  renderMethod();
  bindControls();
  bindFolds();
  observeBars();
  trackView('/').then(watchViewers); // afterwards, so this visitor is in the count
}

/* ---------- Meta & hero ---------- */
function renderMeta(data) {
  $('#nav-updated').textContent = t('nav.updated', { ago: ago(data.updated) });
  $('#nav-updated').title = new Date(data.updated).toLocaleString(locale());
  const sc = data.scout || {};
  $('#scout-status').textContent = sc.lastRun
    ? `${t('footer.scoutRun', { ago: ago(sc.lastRun) })}${sc.lastSummary ? `: ${sc.lastSummary}` : ''}`
    : t('inbox.every');
  window.addEventListener('scroll', () => $('#nav').classList.toggle('is-scrolled', window.scrollY > 8), { passive: true });
}

function renderHeroArt(site) {
  if (!site.heroImage) return;
  const img = new Image();
  img.onload = () => {
    $('#hero-photo').style.backgroundImage = `url("${encodeURI(site.heroImage)}")`;
    $('#top').classList.add('has-photo');
    if (site.heroCredit) $('#art-credit').textContent = site.heroCredit;
  };
  img.src = site.heroImage;
}

/* ---------- Live viewers ----------
   Read on load, then every 5 minutes from visible tabs only: the free backend plan has tight egress, log and
   realtime-connection limits, so don't poll faster or hold a connection open. */
const LIVE_REFRESH_MS = 5 * 60_000;
function watchViewers() {
  const pill = $('#watching');
  let last = 0;
  const refresh = async () => {
    if (document.hidden) return;
    last = Date.now();
    const n = await getLiveViewers();
    pill.hidden = n === null;
    if (n !== null) pill.textContent = t('hero.watching', { n: n.toLocaleString(locale()) });
  };
  refresh();
  setInterval(refresh, LIVE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (Date.now() - last >= LIVE_REFRESH_MS) refresh(); });
}

/* ---------- Countdown ---------- */
function startCountdown(exe) {
  const box = $('#countdown');
  const by = exe.by ? t('cd.dropBy', { by: exe.by }) : t('cd.drop');
  const released = exe.status === 'released' && exe.releasedAt;
  const target = Date.parse(released ? exe.releasedAt : exe.expectedAt || `${exe.expected}T00:00:00Z`);
  const dayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  $('#cd-title').textContent = released ? t('cd.released') : by;
  const src = exe.source ? ` · <a href="${esc(safeHttp(exe.source))}" target="_blank" rel="noopener">${esc(t('cd.source'))}</a>` : '';
  if (!Number.isFinite(target)) {
    $('#cd-status').textContent = t('cd.noDate');
    return;
  }
  if (released) {
    box.classList.add('is-released');
    $('#cd-foot').innerHTML = `${esc(t('cd.outSince', { day: dayFmt.format(target), time: timeFmt.format(target) }))}${src}`;
  } else {
    const when = exe.timeAnnounced ? `${dayFmt.format(target)}, ${timeFmt.format(target)}` : t('cd.noTime', { day: dayFmt.format(target) });
    $('#cd-foot').innerHTML = `${esc(t('cd.expected', { when }))}${src}`;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    let diff = released ? Date.now() - target : target - Date.now();
    const due = !released && diff <= 0;
    if (due) diff = 0;
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    $('#cd-d').textContent = pad(d);
    $('#cd-h').textContent = pad(h);
    $('#cd-m').textContent = pad(m);
    $('#cd-s').textContent = pad(s);
    box.classList.toggle('is-due', due);
    let status;
    if (released) status = t('cd.sinceRelease');
    else if (!due) status = t('cd.left');
    else {
      const late = (Date.now() - target) / 36e5;
      status = late < 24 ? t('cd.dueNow') : t('cd.overdue', { d: Math.floor(late / 24), h: Math.floor(late % 24) });
    }
    $('#cd-status').textContent = status;
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- Overall ---------- */
function renderOverall(data) {
  const all = data.efforts.filter((e) => !e.nuked); // nuked efforts aren't shown anywhere
  const ov = overall(all);
  const leader = ov.leader?.effort;
  animateNumber($('#ov-score'), ov.score);
  $('#ov-leader').innerHTML = leader
    ? `${esc(t('ov.leader'))} <a href="#effort-${esc(leader.id)}">${esc(leader.name)}</a> ${hasRepo(leader) ? `${esc(t('ov.byOwner', { owner: owner(leader.repo) }))} `
      : leader.basedOn?.length ? `<span class="ov-private"><span class="pb-lock" aria-hidden="true"></span>${t('ov.privateOn', { names: leader.basedOn.map((id) => `<a href="#effort-${esc(id)}">${esc(effortName(id))}</a>`).join(', ') })}</span> ` : ''}${esc(ov.leader.reached === 'groundwork' ? t('ov.stillGroundwork') : t('ov.reached', { label: msLabel(ov.leader.reached) }))}`
    : esc(t('ov.none'));
  $('#ov-stage').textContent = msLabel(ov.furthest.key);
  $('#ov-top3').textContent = `${pct(ov.top3)}%`;
  const booted = all.filter((e) => ladderValue(e.gta?.boots) >= 1).length;
  $('#ov-boot').textContent = `${booted} / ${all.length}`;
  $('#ov-count').textContent = `${all.length}`;

  // "Does GTA VI run on PC yet?": not until someone can play it; mostly once it plays well; yes when it's complete.
  const answer = ov.furthest.key === 'complete' ? 'yes' : ov.score >= 75 ? 'mostly' : ov.furthest.key === 'playable' ? 'sortOf' : 'notYet';
  $('#answer').textContent = t(`answer.${answer}`);

  // Ticks + labels
  const furthestIdx = MILESTONES.findIndex((m) => m.key === ov.furthest.key);
  $('#mega-ticks').innerHTML = MILESTONES.slice(1, -1).map((m) => `<i style="left:${m.at}%"></i>`).join('');
  $('#mega-labels').innerHTML = MILESTONES.map((m, i) => {
    const cls = i <= furthestIdx ? 'is-reached' : i === furthestIdx + 1 ? 'is-next' : '';
    return `<div class="mega-label ${cls}" style="left:${m.at}%" data-tip="${esc(msDesc(m))}" data-tip-title="${esc(msLabel(m.key))}"><b>${m.at}%</b><span class="dot"></span>${esc(msLabel(m.key))}</div>`;
  }).join('') +
    // Between Playable and Complete there's no single next step: the four tracks fill it side by side.
    `<p class="mega-zone" data-tip="${esc(t('method.tracksSub'))}" data-tip-title="${esc(t('method.tracksTitle'))}">${TRACKS.map((tk) => esc(trackLabel(tk))).join(' · ')}</p>`;
  $('#mega-fill').dataset.width = ov.score;

  const top = ov.ranked.slice(0, 6);
  const draw = () => { drawMarkers(top, leader); layoutMegaLabels(); };
  draw();
  document.fonts?.ready.then(draw); // Inter swaps in after first paint and changes label widths
  let raf;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });

  renderHistory(data.history || []);
}

// Avatars sit in one row above the bar, spread apart so they never overlap,
// with a curved leader line down to each effort's true position.
function drawMarkers(ranked, leader) {
  const box = $('#mega-markers');
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W) return;
  const GAP = 42;
  const items = ranked.map((r) => ({ r, x: (r.score / 100) * W })).sort((a, b) => a.x - b.x);
  items.forEach((it, i) => { it.a = i ? Math.max(it.x, items[i - 1].a + GAP) : it.x; });
  const shift = items.reduce((s, it) => s + (it.x - it.a), 0) / Math.max(1, items.length);
  items.forEach((it, i) => {
    it.a += shift;
    it.a = Math.max(18, i ? Math.max(it.a, items[i - 1].a + GAP) : it.a);
  });
  const overflow = items.length ? items[items.length - 1].a - (W - 18) : 0;
  if (overflow > 0) items.forEach((it) => { it.a -= overflow; });

  const avatarY = H - 66;
  const lines = items.map((it) => {
    const y0 = avatarY + 32;
    const priv = isPrivateBuild(it.r.effort);
    const color = it.r.effort === leader ? '#ff2e7e' : priv ? '#7a5cff' : 'var(--line-2)';
    return `<path d="M${it.a} ${y0} C ${it.a} ${y0 + 18}, ${it.x} ${H - 18}, ${it.x} ${H}" fill="none" stroke="${color}" stroke-width="1.6"${priv ? ' stroke-dasharray="3 3"' : ''}/>
            <circle cx="${it.x}" cy="${H - 1}" r="3" fill="${it.r.effort === leader ? '#ff2e7e' : priv ? '#7a5cff' : 'var(--faint)'}"/>`;
  }).join('');
  box.innerHTML = `<svg width="${W}" height="${H}" style="position:absolute;inset:0;overflow:visible" aria-hidden="true">${lines}</svg>` +
    items.map((it, i) => {
      const e = it.r.effort;
      const src = effortAvatar(e);
      const priv = isPrivateBuild(e);
      const face = src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(e.name.slice(0, 2))}">` : `<span class="mk-fallback">${esc(e.name.slice(0, 2))}</span>`;
      // Private builds float, with a lock badge; the tooltip names what they build on.
      const tip = priv
        ? `${msLabel(it.r.reached)} · ${t('private.markerTip', { names: (e.basedOn || []).map(effortName).join(', ') || '-' })}`
        : `${msLabel(it.r.reached)} · ${e.approach || ''}`;
      return `<a class="marker ${e === leader ? 'is-leader' : ''}${priv ? ' is-private' : ''}" href="#effort-${esc(e.id)}" style="left:${it.a}px;bottom:${H - avatarY - 32}px;--i:${i}"
                data-tip-title="${esc(e.name)} · ${pct(it.r.score)}%" data-tip="${esc(tip)}">
                <span class="mk-name">${esc(e.name)} · ${pct(it.r.score)}%</span>
                ${priv ? `<span class="mk-face">${face}<span class="bp-lock"><span class="pb-lock" aria-hidden="true"></span></span></span>` : face}
              </a>`;
    }).join('');
}

// Milestone labels sit under their ticks, 10% apart up to Playable. When neighbours would touch
// (phones, longer translations), they're dealt into the fewest rows that keep every row clear:
// 1-2-1-2, then 1-2-3-1-2-3 and so on, so each row still reads left to right.
function layoutMegaLabels() {
  const box = $('#mega-labels');
  const labels = [...box.querySelectorAll('.mega-label')];
  if (!labels.length || !box.clientWidth) return;
  labels.forEach((l) => { l.style.top = '0px'; });
  const span = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; };
  const spans = labels.map(span);
  // The track names between Playable and Complete share the first row (hidden on phones).
  // Their CSS already stops short of Complete, so only the steps up to Playable are checked against them.
  const zone = box.querySelector('.mega-zone');
  const zoneSpan = zone && zone.getClientRects().length ? span(zone) : null;
  const last = labels.length - 1;
  const GAP = 10;
  const clear = (a, b) => a[1] + GAP <= b[0] || b[1] + GAP <= a[0];
  const fits = (rows) => spans.every((a, i) =>
    (i % rows || i === last || !zoneSpan || clear(a, zoneSpan)) &&
    spans.every((b, j) => j <= i || (j - i) % rows || clear(a, b)));
  let rows = 1;
  while (rows < labels.length && !fits(rows)) rows++;
  const h = Math.max(...labels.map((l) => l.offsetHeight));
  const step = h + 6;
  labels.forEach((l, i) => { l.style.top = `${(i % rows) * step}px`; });
  box.style.height = `${(rows - 1) * step + h + 14}px`;
}

function renderHistory(history) {
  const box = $('#ov-history');
  const pts = history.filter((h) => Number.isFinite(h.leader));
  if (pts.length < 2) return;
  box.hidden = false;
  const W = 1000, H = 70, max = Math.max(30, ...pts.map((p) => p.leader)) * 1.1;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - (v / max) * (H - 6) - 3;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.leader).toFixed(1)}`).join(' ');
  box.innerHTML = `<p>${esc(t('ov.history'))}</p>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(t('ov.historyLabel'))}">
      <defs><linearGradient id="hg" x1="0" x2="1"><stop offset="0" stop-color="#7a5cff"/><stop offset=".55" stop-color="#ff2e7e"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
      <linearGradient id="hf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2e7e" stop-opacity=".18"/><stop offset="1" stop-color="#ff2e7e" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#hf)"/>
      <path d="${d}" fill="none" stroke="url(#hg)" stroke-width="3" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

/* ---------- Changes ---------- */
function renderChanges(changes) {
  const list = $('#changes-list');
  const items = [...changes].reverse().slice(0, 12);
  if (!items.length) { $('#changes').hidden = true; return; }
  const cls = { up: 'ck-up', down: 'ck-down', flag: 'ck-flag', new: 'ck-new', removed: 'ck-down', claim: 'ck-flag' };
  list.innerHTML = items.map((c) => `<li><span class="ck ${cls[c.kind] || ''}"></span><time>${esc(new Date(`${c.date}T12:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }))}</time><span>${esc(c.text)}</span></li>`).join('');
}

/* ---------- Race ---------- */
function isGtaSpecific(e) { return /gta/i.test(e.target || ''); }

// The graphics cards a build has been run on (`gpu`: ["AMD"], ["NVIDIA"] or both, main one first),
// from its README's test machine or the owner's report. Left off when nobody has said.
// "Mac" means it runs on a Mac (Apple's own graphics).
const GPU_CLASS = { AMD: 'tag-amd', NVIDIA: 'tag-nvidia', Intel: 'tag-intel', Mac: 'tag-mac' };
const gpuTitle = (v) => (v === 'Mac' ? t('effort.macTitle') : t('effort.gpuTitle', { v }));
const gpuTags = (e) => (Array.isArray(e.gpu) ? e.gpu : []).filter((v) => GPU_CLASS[v])
  .map((v) => `<span class="tag ${GPU_CLASS[v]}" title="${esc(gpuTitle(v))}">${esc(v)}</span>`).join('');

// The race's filter chips: "All", then one per brand that at least one build in the race has run on,
// so Intel or Mac chips only appear once such a build is in the race.
function renderFilterChips() {
  const inRace = state.data.efforts.filter((e) => e.tier === 'tracked' && !e.nuked && !isPrivateBuild(e));
  const brands = Object.keys(GPU_CLASS).filter((v) => inRace.some((e) => Array.isArray(e.gpu) && e.gpu.includes(v)));
  $('#race-chips').innerHTML = `<button class="chip is-on" data-filter="all">${esc(t('race.all'))}</button>` +
    brands.map((v) => `<button class="chip" data-filter="${esc(v)}" title="${esc(gpuTitle(v))}">${esc(v)}</button>`).join('');
}

function renderRace() {
  const { data, filter, sort } = state;
  // Only public code is ranked; private builds get their own unranked list below the race.
  // Nuked efforts (taken offline) aren't shown (owner's call, 2026-11-25). They stay in tracker.json,
  // where their repo names keep the scout from listing copies of them as new candidates.
  let list = data.efforts.filter((e) => e.tier === 'tracked' && !e.nuked && !isPrivateBuild(e));
  // The AMD / NVIDIA chips keep the builds that have run on that brand of card (`gpu`).
  if (GPU_CLASS[filter]) list = list.filter((e) => Array.isArray(e.gpu) && e.gpu.includes(filter));
  const byScore = (a, b) => Number(!!a.nuked) - Number(!!b.nuked) || b._s.score - a._s.score || byStars(a, b);
  const sorters = {
    score: byScore,
    stars: byStars,
    active: (a, b) => Date.parse(b.stats?.pushedAt || 0) - Date.parse(a.stats?.pushedAt || 0),
  };
  const ranked = [...data.efforts.filter((e) => e.tier === 'tracked' && !e.nuked && !isPrivateBuild(e))].sort(byScore);
  const rankedInFilter = list.filter((e) => !e.nuked).sort(byScore);
  const filtered = filter !== 'all';
  list.sort(sorters[sort] || byScore);
  $('#race-list').innerHTML = list.map((e, i) => {
    const overall = e.nuked ? null : ranked.indexOf(e) + 1;
    const rank = e.nuked ? null : filtered ? rankedInFilter.indexOf(e) + 1 : overall;
    return effortCard(e, rank, sort === 'score' && !e.nuked ? i < 3 : false, filtered ? overall : null);
  }).join('') ||
    `<li class="empty">${esc(t('race.empty'))}</li>`;
  renderPrivateBuilds();
  observeBars();
}

/* ---------- Private builds ---------- */
const privateBuilds = () => state.data.efforts
  .filter((e) => e.tier === 'tracked' && !e.nuked && isPrivateBuild(e))
  .sort((a, b) => b._s.score - a._s.score);
const effortName = (id) => state.data.efforts.find((e) => e.id === id)?.name || id;

function renderPrivateBuilds() {
  const list = privateBuilds();
  $('#private-builds').hidden = !list.length;
  $('#private-list').innerHTML = list.map(privateCard).join('');
}

// No score or rank: the stage it reports, how we know, and the public projects it builds on.
function privateCard(e) {
  const url = effortUrl(e);
  const src = effortAvatar(e);
  const bases = (e.basedOn || []).map((id) => `<a href="#effort-${esc(id)}">${esc(effortName(id))}</a>`).join(` ${esc(t('private.and'))} `);
  return `
  <li class="pb" id="effort-${esc(e.id)}">
    <div class="pb-top">
      ${src ? `<img class="e-avatar" src="${esc(src)}" alt="" loading="lazy" data-hide-on-error>` : `<span class="pb-avatar" aria-hidden="true">${esc(e.name.slice(0, 2))}</span>`}
      <div class="e-title">
        <h3>${url ? `<a href="${esc(url)}">${esc(e.name)}</a>` : esc(e.name)}</h3>
        <p class="e-by">${esc(e.byline || '')}</p>
      </div>
      <div class="pb-stage"><b>${pct(e._s.score)}<span>%</span></b><small>${esc(t('private.notRanked', { stage: msLabel(e._s.reached) }))}</small></div>
    </div>
    <div class="tags">
      ${bases ? `<span class="tag tag-based">${t('private.basedOn', { names: bases })}</span>` : ''}
      ${gpuTags(e)}
      ${e.evidence ? `<span class="tag tag-self" title="${esc(t('private.evidenceTitle'))}">${esc(t('private.evidence', { x: e.evidence }))}</span>` : ''}
      <span class="tag tag-stale">${esc(t('private.noCode'))}</span>
      ${e.proof?.url ? `<a class="tag tag-proof" href="${esc(safeHttp(e.proof.url))}" target="_blank" rel="noopener nofollow" title="${esc(e.proof.url)}">${esc(e.proof.label || 'Watch')} ↗</a>` : ''}
    </div>
    <p class="e-summary">${esc(e.summary)}</p>
    <div class="pb-ladder">${ladderCells(e)}</div>
    ${url ? `<a class="pb-more" href="${esc(url)}">${esc(t('private.article'))} →</a>` : ''}
  </li>`;
}

// On a public project's card: the private builds that build on its code, best first.
const privateKids = (e) => privateBuilds().filter((p) => (p.basedOn || []).includes(e.id));

const buildFace = (p) => {
  const src = effortAvatar(p);
  return src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(p.name.slice(0, 2))}">` : esc(p.name.slice(0, 2));
};

// Floating bubbles over the card's bar, each where that private build would score.
// Bubbles closer than 6% of the bar would overlap, so each one rises a level above the ones near it.
function buildPins(kids) {
  const placed = [];
  const pins = kids.map((p, i) => {
    const x = Math.min(97, Math.max(3, p._s.score));
    const level = placed.filter((q) => Math.abs(q - x) < 6).length;
    placed.push(x);
    return { p, i, x, level };
  });
  const maxLevel = Math.max(0, ...pins.map((q) => q.level));
  return { maxLevel, html: `<div class="bp-layer">${pins.map(({ p, i, x, level }) => `
    <a class="bp" href="#effort-${esc(p.id)}" style="left:${x}%;--i:${i};--lift:${level * 46}px"
       data-tip-title="${esc(p.name)} · ${pct(p._s.score)}%" data-tip="${esc(t('private.pinTip', { stage: msLabel(p._s.reached) }))}">
      <span class="bp-bubble">${buildFace(p)}<span class="bp-lock"><span class="pb-lock" aria-hidden="true"></span></span></span>
      <span class="bp-stem" aria-hidden="true"></span>
    </a>`).join('')}</div>` };
}

// A small ranking inside the card: this repo and the private builds on its code, side by side.
function onThisCode(e, kids) {
  if (!kids.length) return '';
  const rows = [...kids, e].sort((a, b) => b._s.score - a._s.score);
  return `<div class="otc">
    <p class="otc-title"><span class="pb-lock" aria-hidden="true"></span>${esc(t('effort.onThisCode'))}</p>
    <ol>${rows.map((r, i) => {
      const self = r === e;
      return `<li class="${self ? 'otc-self' : 'otc-private'}">
        <span class="otc-rank">${i + 1}</span>
        <span class="otc-av">${self ? (effortAvatar(r) ? `<img src="${esc(effortAvatar(r))}" alt="" loading="lazy" data-hide-on-error>` : '') : buildFace(r)}</span>
        <span class="otc-name">${self ? esc(r.name) : `<a href="#effort-${esc(r.id)}">${esc(r.name)}</a>`}</span>
        <span class="otc-badge ${self ? 'is-self' : ''}">${esc(self ? t('effort.thisRepo') : t('effort.privateBadge'))}</span>
        <span class="otc-stage">${esc(msLabel(r._s.reached))}</span>
        <b>${pct(r._s.score)}%</b>
      </li>`;
    }).join('')}</ol>
  </div>`;
}

// The six steps to Playable, then the four tracks (greyed out until Playable, when they start to count).
function ladderCells(e) {
  const g = e.gta || {};
  const gw = e._s.groundwork;
  const st = (v) => (v >= 1 ? 'is-reached' : v > 0 ? 'is-partial' : '');
  // Past "Exe runs" the score no longer depends on groundwork, so that step reads as done.
  const pastGroundwork = ladderValue(g.loads) >= 1;
  const steps = ['loads', 'boots', 'menu', 'world', 'playable'].map((k) =>
    `<span class="${st(ladderValue(g[k]))}" title="${esc(msDesc(MILESTONES.find((m) => m.key === k)))}">${esc(msLabel(k))}</span>`).join('');
  return `<div class="ladder">
      <span class="${pastGroundwork ? 'is-reached' : st(gw)}" title="${esc(msDesc(MILESTONES[0]))}">${esc(pastGroundwork ? msLabel('groundwork') : t('effort.groundworkPct', { n: Math.round(gw * 100) }))}</span>
      ${steps}
    </div>
    ${trackRow(e)}`;
}

// What each track reads as, in words: a written step, a frame rate or a stability label.
function trackText(key, g, v) {
  if (key === 'perf') return g.fps ? t('effort.fps', { n: Math.round(g.fps) }) : t('track.unmeasured');
  if (key === 'stability') return stabLabel(stabilityKey(g.stability));
  const step = trackStep(key, v);
  return step ? stepLabel(key, step) : '';
}

function trackRow(e) {
  const g = e.gta || {};
  const on = e._s.playable;
  return `<div class="tracks${on ? '' : ' is-locked'}" ${on ? '' : `title="${esc(t('track.locked'))}"`}>
    ${TRACKS.map((tr) => {
      const v = e._s.tracks[tr.key];
      return `<div class="trk" title="${esc(trackDesc(tr))}">
        <span class="trk-label">${esc(trackLabel(tr))}</span>
        <span class="trk-bar"><i data-width="${on ? v * 100 : 0}"></i></span>
        <span class="trk-val">${esc(on ? trackText(tr.key, g, v) : '–')}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function effortCard(e, rank, open, overallRank = null) {
  const s = e._s;
  const kids = privateKids(e);
  const pins = kids.length ? buildPins(kids) : null;
  const st = e.stats || {};
  const ticks = MILESTONES.slice(1, -1).map((m) => `<i style="left:${m.at}%"></i>`).join('');
  const stale = st.pushedAt && daysSince(st.pushedAt) > 3;
  const tags = [
    e.approach && `<span class="tag">${esc(e.approach)}</span>`,
    e.target && `<span class="tag ${isGtaSpecific(e) ? 'tag-gta' : ''}">${esc(e.target)}</span>`,
    gpuTags(e),
    e.verification === 'reproduced'
      ? `<span class="tag tag-ok">${esc(t('effort.reproduced'))}</span>`
      // The owner has seen the build run (owner's call): stronger than the README alone.
      : e.verification === 'portwatch'
        ? `<span class="tag tag-ok" title="${esc(t('effort.verifiedTitle'))}">${esc(t('effort.verified'))}</span>`
        : `<span class="tag tag-self" title="${esc(t('effort.selfTitle'))}">${esc(t('effort.self'))}</span>`,
    e.provenOn && ladderValue(e.groundwork?.proven) > 0 && `<span class="tag tag-proven" title="${esc(t('effort.runsTitle'))}">${esc(t('effort.runs', { x: e.provenOn }))}</span>`,
    stale && `<span class="tag tag-stale">${esc(t('effort.quiet', { n: Math.floor(daysSince(st.pushedAt)) }))}</span>`,
    st.missing && `<span class="tag tag-stale">${esc(t('effort.gone'))}</span>`,
    st.dmca && `<a class="tag tag-stale" href="${esc(safeHttp(st.dmca.url))}" target="_blank" rel="noopener" title="${esc(t('effort.dmcaTitle'))}">${esc(t('effort.dmca', { date: st.dmca.date || '' }))}</a>`,
    // A recording that backs the entry up (owner-added), opened off-site.
    e.proof?.url && `<a class="tag tag-proof" href="${esc(safeHttp(e.proof.url))}" target="_blank" rel="noopener nofollow" title="${esc(e.proof.url)}">${esc(e.proof.label || 'Watch')} ↗</a>`,
  ].filter(Boolean).join('');
  const gwRows = GROUNDWORK.map((g) => {
    const v = Math.max(0, Math.min(1, +(e.groundwork?.[g.key]) || 0));
    return `<div class="gw-row" title="${esc(gwDesc(g))}"><span>${esc(gwLabel(g))}</span><b>${Math.round(v * 100)}%</b><div class="gw-bar"><i data-width="${v * 100}"></i></div></div>`;
  }).join('');
  const claims = (e.claims || []).slice(0, 2).map((c) => `<div class="claim"><b>${esc(t('effort.claim'))}</b> “${esc(c.text)}”, ${esc(t('effort.mayMean'))} <em>${esc(claimLabel(c.milestone))}</em>. ${esc(t('effort.awaiting'))}</div>`).join('');
  const src = effortAvatar(e);
  const url = effortUrl(e);
  const external = (hasRepo(e) || homeUrl(e)) ? ' target="_blank" rel="noopener"' : '';
  return `
  <li class="effort ${rank && rank <= 3 ? 'is-top' : ''}${e.nuked ? ' is-nuked' : ''}" id="effort-${esc(e.id)}">
    <div class="e-rank">${e.nuked ? `<span class="nuke-rank" title="${esc(t('effort.nukedTitle', { date: e.nuked.at || '' }))}">${ICON.nuke}</span>` : rank}${overallRank ? `<small class="e-rank-overall" title="${esc(t('race.overallTitle'))}">${esc(t('race.overall', { n: overallRank }))}</small>` : ''}</div>
    <div class="e-main">
      ${e.nuked ? `<div class="nuke-banner" title="${esc(t('effort.nukedTitle', { date: e.nuked.at || '' }))}">${ICON.nuke}<b>${esc(t('effort.nuked'))}</b><span>${esc(e.nuked.note || '')}</span></div>` : ''}
      <div class="e-top">
        ${src ? `<img class="e-avatar" src="${esc(src)}" alt="" loading="lazy" data-hide-on-error>` : ''}
        <div class="e-title">
          <h3>${url ? `<a href="${esc(url)}"${external}>${esc(e.name)}</a>` : esc(e.name)}</h3>
          <p class="e-by">${hasRepo(e) ? `${esc(e.repo)}${e.branch && !['main', 'master'].includes(e.branch) ? ` · ${esc(t('effort.branch', { b: e.branch }))}` : ''}` : esc(e.byline || '')}</p>
        </div>
        <div class="e-score"><b>${pct(s.score)}<span>%</span></b><small>${esc(msLabel(s.reached))}</small></div>
      </div>
      <div class="tags">${tags}</div>
      <p class="e-summary">${esc(e.summary)}</p>
      ${onThisCode(e, kids)}
      <div class="bar${pins ? ' has-pins' : ''}"${pins?.maxLevel ? ` style="margin-top:${50 + pins.maxLevel * 46}px"` : ''} aria-label="${esc(t('effort.progressLabel', { name: e.name, n: pct(s.score) }))}">
        ${pins ? pins.html : ''}
        <div class="bar-track"><div class="bar-fill" data-width="${s.score}"></div><div class="bar-ticks">${ticks}</div></div>
        ${ladderCells(e)}
      </div>
      ${claims}
      <div class="e-details" ${open ? '' : 'hidden'}>
        ${e.groundwork ? `<div class="gw">
          <h4>${esc(t('effort.gwBreakdown'))}</h4>
          ${gwRows}
          ${e.provenOn ? `<p class="gw-proven">${esc(t('effort.provenOn', { x: e.provenOn }))}</p>` : ''}
        </div>` : ''}
        <div class="notes">
          <div class="works"><h4>${esc(t('effort.works'))}</h4><ul>${(e.highlights || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>
          <div class="blocks"><h4>${esc(t('effort.blocking'))}</h4><ul>${(e.blockers || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>
        </div>
      </div>
      <div class="e-foot">
        ${hasRepo(e) ? `<span class="stat-i" title="${esc(t('effort.stars'))}">${ICON.star}${fmtK(st.stars)}</span>
        <span class="stat-i" title="${esc(t('effort.forks'))}">${ICON.fork}${fmtK(st.forks)}</span>
        <span class="stat-i" title="${esc(t('effort.issues'))}">${ICON.issue}${fmtK(st.openIssues)}</span>
        ${st.commits7d != null ? `<span class="stat-i" title="${esc(t('effort.commitsTitle'))}">${ICON.commit}${esc(t('effort.commits', { n: st.commits7d >= 100 ? '100+' : st.commits7d }))}</span>` : ''}
        <span class="stat-i" title="${esc(t('effort.lastPush'))}">${ICON.clock}${esc(t('effort.pushed', { ago: ago(st.pushedAt) }))}</span>` : ''}
        <span class="spacer"></span>
        <span class="w-muted" title="${esc(t('effort.reviewedTitle'))}">${esc(e.assessedBy === 'claude' ? t('effort.byClaude') : t('effort.reviewed'))} ${esc(e.assessedAt || '')}</span>
        <button class="toggle" data-toggle aria-expanded="${open}">${esc(open ? t('effort.hideDetails') : t('effort.details'))}</button>
        ${(hasRepo(e) || homeUrl(e)) ? `<a class="gh-link" href="${esc(url)}" target="_blank" rel="noopener">${homeUrl(e) ? ICON.ext : ICON.gh}${homeUrl(e) ? esc(new URL(homeUrl(e)).host) : 'GitHub'}</a>` : ''}
      </div>
    </div>
  </li>`;
}

/* ---------- Watchlist ---------- */
function renderWatchlist(data) {
  const rows = data.efforts.filter((e) => e.tier === 'watchlist').sort((a, b) => b._s.score - a._s.score || byStars(a, b));
  if (!rows.length) { $('#watchlist').hidden = true; return; }
  foldLabel($('#watch-toggle'), t('fold.projects', { n: rows.length }));
  const head =['watch.project', 'watch.approach', 'watch.progress', 'watch.stars', 'watch.lastPush'].map((k) => `<span>${esc(t(k))}</span>`).join('');
  $('#watch-list').innerHTML = `
    <div class="w-row w-head" role="row">${head}</div>` +
    rows.map((e) => `
    <div class="w-row" role="row" id="effort-${esc(e.id)}">
      <div class="w-name"><a href="${esc(effortUrl(e) || '#')}" target="_blank" rel="noopener">${esc(e.name)}</a><p>${esc(e.summary)}</p></div>
      <span class="w-muted">${esc(e.approach)}${e.target && /gta|ps5/i.test(e.target) ? ` · ${esc(e.target)}` : ''}${e.gpu?.length ? `<span class="w-gpu">${gpuTags(e)}</span>` : ''}</span>
      <div class="w-bar"><div class="bar-track"><div class="bar-fill" data-width="${e._s.score}"></div></div><b>${pct(e._s.score)}%</b></div>
      <span class="w-muted">★ ${fmtK(e.stats?.stars)}</span>
      <span class="w-muted">${esc(ago(e.stats?.pushedAt))}</span>
    </div>`).join('');
}

/* ---------- Toolkit ---------- */
function renderTools(tools) {
  if (!tools.length) { $('#toolkit').hidden = true; return; }
  foldLabel($('#tools-toggle'), t('fold.tools', { n: tools.length }));
  $('#tools-list').innerHTML = tools.map((x) => `
    <a class="tool" href="${esc(repoUrl(x.repo))}" target="_blank" rel="noopener">
      <span class="t-kind">${esc(x.kind)}</span>
      <h3>${esc(x.name)}</h3>
      <p>${esc(x.desc)}</p>
      <span class="t-meta">★ ${fmtK(x.stats?.stars)} · ${esc(t('effort.pushed', { ago: ago(x.stats?.pushedAt) }))}</span>
    </a>`).join('');
}

/* ---------- Folded sections ---------- */
// The watchlist and the toolkit start closed (owner's call, 2026-11-25): a <details> per section.
function foldLabel(summary, showText) {
  summary.innerHTML = `<span class="fold-show">${esc(showText)}</span><span class="fold-hide">${esc(t('fold.hide'))}</span>`;
}
// A link to something inside a closed section (#effort-… from the change feed or the bar) opens it first.
function bindFolds() {
  const openFor = (hash) => {
    if (!/^#[\w-]+$/.test(hash || '')) return;
    const el = document.getElementById(hash.slice(1));
    const fold = el?.closest('details.fold');
    if (!fold || fold.open) return;
    fold.open = true;
    observeBars();
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  };
  window.addEventListener('hashchange', () => openFor(location.hash));
  document.addEventListener('click', (ev) => { const a = ev.target.closest?.('a[href^="#"]'); if (a) openFor(a.getAttribute('href')); });
  openFor(location.hash);
}

/* ---------- News ---------- */
const safeLink = (u) => (/^#[\w-]+$/.test(u || '') ? u : safeHttp(u));
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
// A post's day and time in the reader's own time zone, or the day alone for older posts.
const fmtWhen = (n) => {
  const at = newsTime(n);
  return at ? new Date(at).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : fmtDay(n.date);
};
const whenTag = (n) => `<time datetime="${esc(newsTime(n) || n.date)}">${esc(fmtWhen(n))}</time>`;

function storyMedia(n) {
  const img = n.image && /^https:\/\//.test(n.image.url || '')
    ? `<img src="${esc(n.image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-cover="${esc(n.category)}">`
    : coverHtml(n.category);
  return `<div class="story-media">${img}<span class="story-cat">${esc(catLabel(n.category))}</span></div>`;
}

function renderNews(news) {
  // Newest first, by publish time (or day, for older posts); ties keep their order in the data.
  const items = [...news].sort(byNewest);
  if (!items.length) { $('#news').hidden = true; return; }
  // Real links to each article's own page (built at deploy) so search engines can follow them;
  // a plain click opens the article in the reader instead.
  const card = (n, small) => `
    <a class="story ${small ? 'is-small' : ''}" href="${esc(articlePath(n) || '#news')}" data-story="${esc(n.id)}">
      ${storyMedia(n)}
      <div class="story-body">
        ${whenTag(n)}
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.dek)}</p>
        ${!small && n.image?.credit ? `<span class="story-credit">${esc(t('news.image'))} ${esc(n.image.credit)}</span>` : ''}
      </div>
    </a>`;
  $('#news-list').innerHTML = card(items[0], false) + `<div class="news-list">${items.slice(1, 7).map((n) => card(n, true)).join('')}</div>`;
  const heads = (state.data.headlines || []).slice(0, 10);
  if (heads.length) {
    $('#news-list').insertAdjacentHTML('afterend', `
      <div class="headlines card">
        <h3 class="mini-title">${esc(t('news.headlines'))} <span class="w-muted">${esc(t('news.headlinesNote'))}</span></h3>
        <ul>${heads.map((h) => `<li><a href="${esc(safeHttp(h.link))}" target="_blank" rel="noopener noreferrer">${esc(h.title)}</a><span>${esc(h.outlet)} · ${esc(ago(h.date))}</span></li>`).join('')}</ul>
      </div>`);
  }

  const dlg = $('#reader');
  $('#news-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-story]');
    if (!btn) return;
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // new tab/window: let the link work
    const n = items.find((x) => x.id === btn.dataset.story);
    if (!n) return;
    ev.preventDefault();
    const page = articlePath(n);
    $('#reader-body').innerHTML = `
      ${storyMedia(n)}
      <div class="reader-inner">
        <p class="meta">${esc(catLabel(n.category))} · ${whenTag(n)}</p>
        <h2 id="reader-title">${esc(n.title)}</h2>
        <p class="dek">${esc(n.dek)}</p>
        <div class="article">${(n.body || []).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        <div class="sources">
          <h4>${esc(t('news.sources'))}</h4>
          <ul>${(n.sources || []).map((s) => `<li><a href="${esc(safeLink(s.url))}" ${s.url?.startsWith('#') ? '' : 'target="_blank" rel="noopener"'}>${esc(s.outlet)}: ${esc(s.title)}</a></li>`).join('')}</ul>
          <p class="fine">${n.image?.credit ? `${esc(t('news.image'))} <a href="${esc(safeHttp(n.image.link || n.image.url))}" target="_blank" rel="noopener">${esc(n.image.credit)}</a>. ` : ''}${esc(n.by === 'claude' ? t('news.byClaude') : n.by === 'report' ? t('news.byReport') : t('news.byPortWatch'))}${page ? ` <a href="${esc(page)}">${esc(t('news.link'))}</a>` : ''}</p>
        </div>
      </div>`;
    dlg.showModal();
    dlg.scrollTop = 0;
  });
  $('#reader-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  $('#reader-body').addEventListener('click', (ev) => { if (ev.target.closest('a[href^="#"]')) dlg.close(); });
}

/* ---------- Safety ---------- */
/* ---------- Method ---------- */
function renderMethod() {
  const gwShare = MILESTONES[1].at;
  const playAt = MILESTONES.find((m) => m.key === 'playable').at;
  const span = MILESTONES[MILESTONES.length - 1].at - playAt;
  $('#ladder-explain').innerHTML = MILESTONES.filter((m) => m.key !== 'complete').map((m, i) => `
    <li><span class="le-at">${i === 0 ? `0–${gwShare}` : m.at}</span><div><h4>${esc(msLabel(m.key))}</h4><p>${esc(msDesc(m))}</p></div></li>`).join('') +
    `<li class="le-tracks"><span class="le-at">${playAt}–100</span><div><h4>${esc(t('method.tracksTitle'))}</h4><p>${esc(t('method.tracksSub'))}</p>
      <ul>${TRACKS.map((tk) => `<li><b>${esc(trackLabel(tk))}<span>${esc(t('method.pts', { n: Math.round(tk.weight * span * 10) / 10 }))}</span></b>${esc(trackDesc(tk))}${
        tk.steps ? `<small>${tk.steps.map((s) => esc(stepLabel(tk.key, s))).join(' → ')}</small>` : ''}</li>`).join('')}</ul></div></li>`;
  $('#gw-explain').innerHTML = GROUNDWORK.map((g) => `<li><b>${esc(gwLabel(g))}<span>${esc(t('method.pts', { n: Math.round(g.weight * gwShare * 10) / 10 }))}</span></b>${esc(gwDesc(g))}</li>`).join('');
}

/* ---------- Interaction ---------- */
function bindControls() {
  $$('.chip[data-filter]').forEach((b) => b.addEventListener('click', () => {
    $$('.chip[data-filter]').forEach((x) => x.classList.toggle('is-on', x === b));
    state.filter = b.dataset.filter;
    renderRace();
  }));
  $('#sort').addEventListener('change', (ev) => { state.sort = ev.target.value; renderRace(); });
  $('#race-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-toggle]');
    if (!btn) return;
    const det = btn.closest('.effort').querySelector('.e-details');
    det.hidden = !det.hidden;
    btn.setAttribute('aria-expanded', String(!det.hidden));
    btn.textContent = det.hidden ? t('effort.details') : t('effort.hideDetails');
    observeBars();
  });

  // Avatar fallbacks without inline handlers.
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.cover != null) {
      img.insertAdjacentHTML('afterend', coverHtml(img.dataset.cover));
      img.remove();
    } else if (img.dataset.fallback != null) {
      const span = document.createElement('span');
      span.className = 'mk-fallback';
      span.textContent = img.dataset.fallback;
      img.replaceWith(span);
    } else if (img.hasAttribute('data-hide-on-error')) {
      img.style.visibility = 'hidden';
    }
  }, true);

  const tip = $('#tooltip');
  document.addEventListener('pointerover', (ev) => {
    const el = ev.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = `${el.dataset.tipTitle ? `<b>${esc(el.dataset.tipTitle)}</b>` : ''}${esc(el.dataset.tip)}`;
    tip.hidden = false;
  });
  document.addEventListener('pointermove', (ev) => {
    if (tip.hidden) return;
    const x = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
    tip.style.left = `${x}px`;
    tip.style.top = `${ev.clientY + 16}px`;
  });
}

let io;
function observeBars() {
  // Watch each bar's track, not the fill: a fill clipped to 0% counts as invisible.
  io ??= new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      for (const el of en.target.querySelectorAll('[data-width]')) reveal(el);
      io.unobserve(en.target);
    }
  }, { threshold: 0.2 });
  $$('[data-width]:not([data-seen])').forEach((el) => { el.dataset.seen = '1'; io.observe(el.parentElement); });
}
function reveal(el) {
  el.style.setProperty('--p', `${Math.max(0, Math.min(100, +el.dataset.width || 0))}%`);
}

function animateNumber(node, to) {
  const start = performance.now();
  const dur = 1600;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = (to * eased).toFixed(to % 1 ? 1 : 0);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:12px 20px;background:#fff3f3;color:#b4262b;margin:0">${esc(t('error.load', { msg: err.message }))}</p>`);
});
