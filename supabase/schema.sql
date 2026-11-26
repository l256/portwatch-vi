-- PortWatch VI backend: discussion board + anonymous page views + admin dashboard access.
-- Run once in the Supabase SQL editor. Safe to re-run.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Private settings (not exposed through the API) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);
insert into private.settings (key, value)
  values ('ip_salt', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (key) do nothing;

-- ---------- Admins (the site owner) ----------
create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- The first signed-in account may claim admin once; after that, nobody else can.
create or replace function public.claim_admin() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.admins) then return public.is_admin(); end if;
  insert into public.admins (user_id) values (auth.uid());
  return true;
end $$;
revoke all on function public.claim_admin() from public, anon;
grant execute on function public.claim_admin() to authenticated;

-- ---------- Board: threads and replies ----------
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  board text not null check (board ~ '^[a-z0-9-]{1,40}$'),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  author text not null default 'Anonymous' check (char_length(author) between 1 and 32),
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  flag_reason text,
  reply_count int not null default 0,
  created_at timestamptz not null default now(),
  last_activity timestamptz not null default now(),
  ip_hash text
);
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  author text not null default 'Anonymous' check (char_length(author) between 1 and 32),
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  flag_reason text,
  created_at timestamptz not null default now(),
  ip_hash text
);
create index if not exists threads_board_activity on public.threads (board, last_activity desc);
create index if not exists posts_thread_created on public.posts (thread_id, created_at);
-- Added after launch, so it can't live in the create table above. Must exist before the column grants below.
alter table public.posts add column if not exists like_count int not null default 0;

-- Salted, daily-rotating hash of the client address, used only for flood limits. Raw IPs are never stored.
create or replace function private.client_hash() returns text
language plpgsql stable security definer set search_path = '' as $$
declare hdr json; ip text; salt text;
begin
  hdr := nullif(current_setting('request.headers', true), '')::json;
  ip := btrim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', hdr ->> 'x-forwarded-for', ''), ',', 1));
  if ip = '' then return null; end if; -- unknown client: skip flood limits rather than lump everyone together
  select value into salt from private.settings where key = 'ip_salt';
  return encode(extensions.digest(ip || '|' || current_date::text || '|' || coalesce(salt, ''), 'sha256'), 'hex');
end $$;

-- Anything that looks like a link (URLs, bare domains, magnets, invites) is held for review.
create or replace function private.has_link(t text) returns boolean
language sql immutable as $$
  select t ~* '(https?://|www\.|magnet:|discord\.gg|t\.me/|[a-z0-9-]+\.(com|net|org|io|gg|me|ru|xyz|app|dev|ly|co|to|cc|link|zip|exe)(\W|$))';
$$;

create or replace function private.guard_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text; recent int; today int;
begin
  h := private.client_hash();
  if h is not null then
    select count(*) into recent from (
      select 1 from public.threads where ip_hash = h and created_at > now() - interval '10 minutes'
      union all select 1 from public.posts where ip_hash = h and created_at > now() - interval '10 minutes') r;
    if recent >= 5 then raise exception 'Slow down: too many posts in a short time. Try again in a few minutes.'; end if;
    select count(*) into today from (
      select 1 from public.threads where ip_hash = h and created_at > now() - interval '1 day'
      union all select 1 from public.posts where ip_hash = h and created_at > now() - interval '1 day') d;
    if today >= 40 then raise exception 'Daily posting limit reached. Try again tomorrow.'; end if;
  end if;

  new.ip_hash := h;
  new.created_at := now();
  new.author := left(coalesce(nullif(btrim(new.author), ''), 'Anonymous'), 32);
  new.flag_reason := null;
  if tg_table_name = 'threads' then
    new.reply_count := 0;
    new.last_activity := now();
    new.status := case when private.has_link(new.title || ' ' || new.body) then 'pending' else 'visible' end;
  else
    if not exists (select 1 from public.threads where id = new.thread_id and status = 'visible') then
      raise exception 'Thread not found.';
    end if;
    new.status := case when private.has_link(new.body) then 'pending' else 'visible' end;
  end if;
  if new.status = 'pending' then new.flag_reason := 'contains a link'; end if;
  return new;
end $$;

drop trigger if exists threads_guard on public.threads;
create trigger threads_guard before insert on public.threads for each row execute function private.guard_content();
drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before insert on public.posts for each row execute function private.guard_content();

-- Keep each thread's reply count and last activity in step with its visible replies.
create or replace function private.sync_thread() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tid uuid := coalesce(new.thread_id, old.thread_id);
begin
  update public.threads t set
    reply_count = (select count(*) from public.posts p where p.thread_id = tid and p.status = 'visible'),
    last_activity = greatest(t.created_at, coalesce((select max(p.created_at) from public.posts p where p.thread_id = tid and p.status = 'visible'), t.created_at))
  where t.id = tid;
  return null;
end $$;
drop trigger if exists posts_sync on public.posts;
create trigger posts_sync after insert or update of status or delete on public.posts for each row execute function private.sync_thread();

-- Public write path: two narrow functions (no direct table inserts).
create or replace function public.create_thread(p_board text, p_title text, p_body text, p_author text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.threads;
begin
  insert into public.threads (board, title, body, author)
    values (lower(btrim(p_board)), btrim(p_title), btrim(p_body), coalesce(p_author, ''))
    returning * into r;
  return json_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.create_post(p_thread uuid, p_body text, p_author text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.posts;
begin
  insert into public.posts (thread_id, body, author) values (p_thread, btrim(p_body), coalesce(p_author, '')) returning * into r;
  return json_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.board_stats() returns table (board text, threads bigint, last_activity timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.board, count(*), max(t.last_activity) from public.threads t where t.status = 'visible' group by t.board;
$$;

alter table public.threads enable row level security;
alter table public.posts enable row level security;
revoke all on public.threads, public.posts from anon, authenticated;
grant select (id, board, title, body, author, status, flag_reason, reply_count, created_at, last_activity) on public.threads to anon, authenticated;
grant select (id, thread_id, body, author, status, flag_reason, created_at, like_count) on public.posts to anon, authenticated;
grant update (status) on public.threads, public.posts to authenticated;

drop policy if exists "read visible threads" on public.threads;
create policy "read visible threads" on public.threads for select to anon, authenticated using (status = 'visible' or public.is_admin());
drop policy if exists "admins moderate threads" on public.threads;
create policy "admins moderate threads" on public.threads for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "read visible posts" on public.posts;
create policy "read visible posts" on public.posts for select to anon, authenticated using (status = 'visible' or public.is_admin());
drop policy if exists "admins moderate posts" on public.posts;
create policy "admins moderate posts" on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.create_thread(text, text, text, text), public.create_post(uuid, text, text), public.board_stats() from public;
grant execute on function public.create_thread(text, text, text, text), public.create_post(uuid, text, text), public.board_stats() to anon, authenticated;

-- ---------- Likes on replies ----------
-- One like per browser per reply: voter is a salted hash of the reply and a random token kept in that browser,
-- so it can't link one browser's likes across replies. Tokens are easy to reset, so the daily client hash caps
-- likes too (3 per reply, to leave room for shared connections, and 60 per 10 minutes).
create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  voter text not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  primary key (post_id, voter)
);
create index if not exists post_likes_client on public.post_likes (ip_hash, created_at);
alter table public.post_likes enable row level security;
revoke all on public.post_likes from public, anon, authenticated;

create or replace function private.sync_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    update public.posts set like_count = like_count - 1 where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists post_likes_sync on public.post_likes;
create trigger post_likes_sync after insert or delete on public.post_likes for each row execute function private.sync_likes();

-- Sets the state instead of toggling it, so a repeated or retried request can't flip a like back.
create or replace function public.set_post_like(p_post uuid, p_token uuid, p_liked boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare h text; v_voter text; salt text;
begin
  if p_post is null or p_token is null or p_liked is null then raise exception 'Invalid like.'; end if;
  if not exists (select 1 from public.posts p join public.threads t on t.id = p.thread_id
                 where p.id = p_post and p.status = 'visible' and t.status = 'visible') then
    raise exception 'Reply not found.';
  end if;
  select value into salt from private.settings where key = 'ip_salt';
  v_voter := encode(extensions.digest(p_post::text || '|' || p_token::text || '|' || coalesce(salt, ''), 'sha256'), 'hex');

  if p_liked then
    h := private.client_hash();
    if h is not null then
      perform pg_advisory_xact_lock(hashtext(h)); -- one client at a time, so parallel requests can't beat the caps
      if not exists (select 1 from public.post_likes where post_id = p_post and voter = v_voter) then
        if (select count(*) from public.post_likes where ip_hash = h and post_id = p_post) >= 3 then
          raise exception 'Like limit reached for this reply on your connection.';
        end if;
        if (select count(*) from public.post_likes where ip_hash = h and created_at > now() - interval '10 minutes') >= 60 then
          raise exception 'Slow down: too many likes in a short time. Try again in a few minutes.';
        end if;
      end if;
    end if;
    insert into public.post_likes (post_id, voter, ip_hash) values (p_post, v_voter, h) on conflict do nothing;
  else
    delete from public.post_likes where post_id = p_post and voter = v_voter;
  end if;

  return json_build_object('liked', p_liked, 'likes', (select like_count from public.posts where id = p_post));
end $$;
revoke all on function public.set_post_like(uuid, uuid, boolean) from public;
grant execute on function public.set_post_like(uuid, uuid, boolean) to anon, authenticated;
notify pgrst, 'reload schema';

-- ---------- Anonymous page views (no cookies, no IPs) ----------
create table if not exists public.pageviews (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  page text not null check (char_length(page) <= 120),
  ref text check (char_length(ref) <= 120),
  sid text check (char_length(sid) <= 40),
  new_session boolean not null default false
);
create index if not exists pageviews_ts on public.pageviews (ts desc);
alter table public.pageviews enable row level security;
revoke all on public.pageviews from anon, authenticated;
grant select on public.pageviews to authenticated;
drop policy if exists "admins read views" on public.pageviews;
create policy "admins read views" on public.pageviews for select to authenticated using (public.is_admin());
-- Sampling (2026-11-24): public pages report about 1 in 5 browser tabs (SAMPLE in assets/js/backend.js), and
-- each view carries the number of tabs it stands for. Every count below sums w instead of counting rows.
-- Older rows have w = 1.
alter table public.pageviews add column if not exists w smallint not null default 1;

-- The weight each view carries is set here, not by the browser. track_view used to store the p_w the client sent
-- (clamped to 1-50), so a script calling the RPC directly could give every made-up session the maximum weight and
-- inflate the live count. Keep this value equal to SAMPLE in assets/js/backend.js; to change it later, run
--   update private.settings set value = '<SAMPLE>' where key = 'view_weight';
insert into private.settings (key, value) values ('view_weight', '20') on conflict (key) do nothing;

-- The 4-argument version is dropped first: two overloads would leave PostgREST unable to choose. p_w has no
-- default, so old copies of the site that still send only the 4 original arguments match nothing and aren't counted.
-- p_w stays in the signature so the site's current calls keep matching, but its value is ignored.
drop function if exists public.track_view(text, text, text, boolean);
drop function if exists public.track_view(text, text, text, boolean, integer);
create or replace function public.track_view(p_page text, p_w integer, p_ref text default null, p_sid text default null, p_new boolean default false) returns void
language sql security definer set search_path = '' as $$
  insert into public.pageviews (page, ref, sid, new_session, w)
  values (left(coalesce(p_page, '/'), 120), left(nullif(p_ref, ''), 120), left(p_sid, 40), coalesce(p_new, false),
          least(greatest(coalesce(
            (select case when s.value ~ '^[0-9]{1,2}$' then s.value::integer end
               from private.settings s where s.key = 'view_weight'),
            1), 1), 50));
$$;
revoke all on function public.track_view(text, integer, text, text, boolean) from public;
grant execute on function public.track_view(text, integer, text, text, boolean) to anon, authenticated;

-- ---------- Public live viewer count ----------
-- Same definition as the dashboard: tabs seen in the last 5 minutes. The threshold lives here, so small
-- numbers never leave the database; below 25 the answer is null and the site shows nothing.
-- The count is worked out at most once a minute and the answer shared: on 2026-11-23, with ~3,000 visitors,
-- recounting per call was 39% of the database's time. Since 2026-11-24 visitors don't call this at all:
-- the site's /api/live (functions/api/live.js) asks once a minute per Cloudflare data centre and caches it.
create table if not exists private.live_cache (
  id smallint primary key default 1 check (id = 1),
  n integer,
  at timestamptz not null default '-infinity'
);
insert into private.live_cache (id) values (1) on conflict (id) do nothing;
alter table private.live_cache enable row level security;  -- no policies: only the owner (live_viewers) reads it

create or replace function public.live_viewers() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  cached_n integer;
  cached_at timestamptz;
begin
  select n, at into cached_n, cached_at from private.live_cache where id = 1;
  -- Fresh enough, or another call is already recounting: hand out the last answer.
  if cached_at > now() - interval '60 seconds' or not pg_try_advisory_xact_lock(hashtext('live_viewers')) then
    return cached_n;
  end if;
  select case when s >= 25 then s end into cached_n from (
    select coalesce(sum(w), 0)::integer as s from (
      select max(w) as w from public.pageviews
      where ts >= now() - interval '5 minutes' and sid <> '' group by sid) t) x;
  update private.live_cache set n = cached_n, at = now() where id = 1;
  return cached_n;
end $$;
revoke all on function public.live_viewers() from public;
grant execute on function public.live_viewers() to anon, authenticated;

-- ---------- Dashboard numbers (admins only) ----------
create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'totals', json_build_object(
      'views_today', (select coalesce(sum(w), 0) from public.pageviews where ts >= date_trunc('day', now())),
      'visitors_today', (select coalesce(sum(mw), 0) from (select max(w) as mw from public.pageviews
        where ts >= date_trunc('day', now()) and sid is not null group by sid) v),
      'views_7d', (select coalesce(sum(w), 0) from public.pageviews where ts > now() - interval '7 days'),
      'visitors_7d', (select coalesce(sum(mw), 0) from (select max(w) as mw from public.pageviews
        where ts > now() - interval '7 days' and sid is not null group by sid) v),
      'views_all', (select coalesce(sum(w), 0) from public.pageviews)),
    'hourly', (select coalesce(json_agg(h order by h.hour), '[]'::json) from (
      select hour, sum(v) as views, coalesce(sum(mw) filter (where sid is not null), 0) as visitors from (
        select date_trunc('hour', ts) as hour, sid, sum(w) as v, max(w) as mw
        from public.pageviews where ts > now() - interval '48 hours' group by 1, 2) s group by 1) h),
    'daily', (select coalesce(json_agg(d order by d.day), '[]'::json) from (
      select day, sum(v) as views, coalesce(sum(mw) filter (where sid is not null), 0) as visitors from (
        select date_trunc('day', ts) as day, sid, sum(w) as v, max(w) as mw
        from public.pageviews where ts > now() - interval '30 days' group by 1, 2) s group by 1) d),
    'pages', (select coalesce(json_agg(p), '[]'::json) from (
      select page, sum(w) as views from public.pageviews where ts > now() - interval '7 days' group by 1 order by 2 desc limit 12) p),
    'refs', (select coalesce(json_agg(r), '[]'::json) from (
      select ref, sum(mw) as visitors from (
        select coalesce(ref, '(direct)') as ref, sid, max(w) as mw from public.pageviews
        where ts > now() - interval '7 days' and new_session and sid is not null group by 1, 2) s
      group by 1 order by 2 desc limit 12) r),
    'board', json_build_object(
      'threads', (select count(*) from public.threads where status = 'visible'),
      'posts', (select count(*) from public.posts where status = 'visible'),
      'pending', (select count(*) from public.threads where status = 'pending') + (select count(*) from public.posts where status = 'pending'),
      'today', (select count(*) from public.threads where created_at >= date_trunc('day', now())) + (select count(*) from public.posts where created_at >= date_trunc('day', now())))
  );
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- People on the site right now, for the dashboard: the tabs seen in the last few minutes (weighted by w),
-- counted here instead of shipping every page view to the browser.
create or replace function public.admin_live(p_minutes integer default 5) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return (
    with latest as (
      select distinct on (sid) sid, page, w from public.pageviews
      where ts >= now() - make_interval(mins => least(greatest(coalesce(p_minutes, 5), 1), 60)) and sid <> ''
      order by sid, ts desc
    )
    select json_build_object(
      'total', (select coalesce(sum(w), 0) from latest),
      'pages', coalesce((select json_agg(p) from (
        select page, sum(w) as n from latest group by page order by 2 desc limit 8) p), '[]'::json))
  );
end $$;
revoke all on function public.admin_live(integer) from public, anon;
grant execute on function public.admin_live(integer) to authenticated;

-- Live updates for the dashboard (row-level security still applies to what each client receives).
-- Page views are not published: decoding and checking every visit for the dashboard's feed was 31% of the
-- database's time under heavy traffic (2026-11-23). New threads and replies still arrive live.
do $$ begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pageviews') then
    alter publication supabase_realtime drop table public.pageviews;
  end if;
  begin alter publication supabase_realtime add table public.threads; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.posts; exception when duplicate_object then null; end;
end $$;

-- ---------- Server-side access for the daily editor (secret key = service_role) ----------
-- This project doesn't grant table access to API roles by default, so the editor's moderation
-- calls (read held posts, set status) need explicit privileges. service_role bypasses row-level security.
grant usage on schema public to service_role;
grant select on public.threads, public.posts, public.admins, public.pageviews to service_role;
grant update (status) on public.threads, public.posts to service_role;
