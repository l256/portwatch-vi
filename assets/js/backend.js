// Anonymous page views and the homepage's "watching now" number, kept light enough for the free-plan
// database (it was swamped on 2026-11-23 and 2026-11-24). Public pages don't load a Supabase client:
// - About 1 in SAMPLE browser tabs sends its page views, each weighted by SAMPLE, so the database's
//   counts (live viewers, dashboard) scale back up. The other tabs send nothing.
// - The live number comes from the site's own /api/live (functions/api/live.js), which asks the
//   database at most once a minute per Cloudflare data centre.
import { SUPABASE_URL, SUPABASE_KEY, STATS_PAUSED } from './config.js';

// Raise it to cut database writes further, or set 1 to count every tab. The weight each view counts for is
// now set in the database, not taken from this file: after changing SAMPLE (1 to 50), also run
//   update private.settings set value = '<SAMPLE>' where key = 'view_weight';
// (see track_view in supabase/schema.sql). 20 since 2026-11-24: at ~12,000 people on the site, 1 in 5 meant
// ~500 writes a minute and ~1.3 GB of Supabase egress a day.
const SAMPLE = 20;

const backendReady = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

// A random id per browser tab (sessionStorage, not a cookie) so visits can be counted without identifying anyone.
function sessionId() {
  try {
    let sid = sessionStorage.getItem('pw_sid');
    const isNew = !sid;
    if (!sid) { sid = crypto.randomUUID().replace(/-/g, '').slice(0, 20); sessionStorage.setItem('pw_sid', sid); }
    return { sid, isNew };
  } catch { return { sid: 'nostorage', isNew: true }; }
}

// The same tab is always in or out of the sample, so its later page views and the live count stay consistent.
const inSample = (sid) => parseInt(sid.slice(0, 6), 16) % SAMPLE === 0;

// How many people are on the site now, or null when there's nothing to show (under 25, paused, or unavailable).
// The answer is cached for a minute by the browser and by Cloudflare. Anything but JSON (no Function in a local
// preview, the free plan's daily Function limit reached) hides the pill.
export async function getLiveViewers() {
  if (STATS_PAUSED) return null;
  try {
    const res = await fetch(new URL('../../api/live', import.meta.url));
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null;
    const { n } = await res.json();
    return Number.isInteger(n) ? n : null;
  } catch { return null; }
}

// Counts the view, for tabs in the sample. The live count is worked out from these views (tabs seen in the
// last few minutes), so visitors don't hold a realtime connection open: that hit the plan's connection limit.
export async function trackView(page) {
  if (!backendReady() || STATS_PAUSED || navigator.doNotTrack === '1') return;
  const { sid, isNew } = sessionId();
  if (!inSample(sid)) return;
  let ref = '';
  try { if (document.referrer) { const r = new URL(document.referrer); if (r.host !== location.host) ref = r.host.replace(/^www\./, ''); } } catch {}
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/track_view`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_page: page, p_ref: ref, p_sid: sid, p_new: isNew, p_w: SAMPLE }),
    });
  } catch { /* analytics must never break the page */ }
}
