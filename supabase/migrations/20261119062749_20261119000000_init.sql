/*
# Ma Ochlim Hayom — initial schema

## Purpose
Restaurant-decision app ("What are we eating today?"). Users swipe through restaurant cards
(solo or with friends). Friend mode uses 4-character session codes, realtime sync via Supabase
realtime, and 24-hour session expiry. No personal data is stored — members are random browser
UUIDs. Also tracks aggregate funnel events for the hidden /stats admin page.

## New Tables
1. `sessions` — friend-match sessions (24h TTL). Columns: code (PK, 4-char), settings (jsonb),
   deck (text[] of place ids), round (int), created_at, expires_at.
2. `session_members` — who joined a session. Columns: code (FK), member_id (uuid), is_creator,
   round, progress, finished, last_seen, joined_at. PK (code, member_id). Max 6 members.
3. `session_likes` — which places each member liked per round. PK (code, member_id, round, place_id).
4. `event_counts` — aggregate funnel counters by day + event name. PK (day, event).

## Security (RLS + Grants)
- All tables have RLS enabled.
- `sessions`: anon/authenticated can SELECT active sessions, INSERT, and UPDATE active sessions.
  Column-level: clients can only write (code, settings, deck); created_at/expires_at are server-set.
- `session_members`: anon/authenticated can SELECT/INSERT/UPDATE on active sessions. Insert checks
  member count < 6.
- `session_likes`: anon/authenticated can SELECT/INSERT/DELETE on active sessions. Insert checks
  member exists.
- `event_counts`: no SELECT grant to anon/authenticated (service-role only via /stats edge function).
  `track_event` function is EXECUTE-granted to anon/authenticated.
- Helper functions `session_is_active` and `session_member_count` are SECURITY DEFINER.
- Storage buckets `data` and `photos` created as public-read.

## Realtime
- `sessions`, `session_members`, `session_likes` added to `supabase_realtime` publication.

## Notes
- `track_event` is an allow-listed RPC — only known event names increment, all others silently no-op.
- `cleanup_expired_sessions` trigger drops sessions expired >1 day whenever a new session is created.
- This is a no-auth app (no sign-in screen). Members are anonymous browser-generated UUIDs.
  Policies use `TO anon, authenticated` so the anon-key frontend can read/write.
*/

-- ───────────────────────── Sessions ─────────────────────────
create table if not exists public.sessions (
  code        text primary key check (code ~ '^[A-Z2-9]{4}$'),
  settings    jsonb not null,
  deck        text[] not null check (cardinality(deck) between 1 and 120),
  round       int not null default 1 check (round between 1 and 50),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);
create index if not exists sessions_expires_idx on public.sessions (expires_at);

create table if not exists public.session_members (
  code        text not null references public.sessions(code) on delete cascade,
  member_id   uuid not null,
  is_creator  boolean not null default false,
  round       int not null default 1,
  progress    int not null default 0 check (progress between 0 and 200),
  finished    boolean not null default false,
  last_seen   timestamptz not null default now(),
  joined_at   timestamptz not null default now(),
  primary key (code, member_id)
);

create table if not exists public.session_likes (
  code        text not null references public.sessions(code) on delete cascade,
  member_id   uuid not null,
  round       int not null,
  place_id    text not null check (char_length(place_id) <= 200),
  created_at  timestamptz not null default now(),
  primary key (code, member_id, round, place_id)
);

-- ───────────────────────── Funnel counters ─────────────────────────
create table if not exists public.event_counts (
  day    date not null default (now() at time zone 'Asia/Jerusalem')::date,
  event  text not null,
  count  bigint not null default 0,
  primary key (day, event)
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.session_is_active(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.code = p_code and s.expires_at > now());
$$;

create or replace function public.session_member_count(p_code text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.session_members m where m.code = p_code;
$$;

-- Increment an allow-listed funnel event (the only write path to event_counts).
create or replace function public.track_event(p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event not in (
    'app_open','cta_click','mode_selected_solo','mode_selected_friend','location_set','price_selected',
    'cuisine_selected','first_swipe','swipe_like','swipe_skip','session_created','friend_joined',
    'match_found','navigate_clicked','share_clicked','solo_result'
  ) then
    return;
  end if;
  insert into public.event_counts (day, event, count)
  values ((now() at time zone 'Asia/Jerusalem')::date, p_event, 1)
  on conflict (day, event) do update set count = public.event_counts.count + 1;
end;
$$;

-- Housekeeping: drop sessions that expired more than a day ago whenever a new one is created.
create or replace function public.cleanup_expired_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.sessions where expires_at < now() - interval '1 day';
  return new;
end;
$$;
drop trigger if exists sessions_cleanup on public.sessions;
create trigger sessions_cleanup after insert on public.sessions
  for each statement execute function public.cleanup_expired_sessions();

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.sessions        enable row level security;
alter table public.session_members enable row level security;
alter table public.session_likes   enable row level security;
alter table public.event_counts    enable row level security; -- no policies: read only via service role (/stats)

-- Column-level privileges: clients can never change created_at / expires_at.
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to anon, authenticated;
grant insert (code, settings, deck) on public.sessions to anon, authenticated;
grant update (settings, deck, round) on public.sessions to anon, authenticated;

revoke all on public.session_members from anon, authenticated;
grant select on public.session_members to anon, authenticated;
grant insert (code, member_id, is_creator, round, progress, finished) on public.session_members to anon, authenticated;
grant update (round, progress, finished, last_seen) on public.session_members to anon, authenticated;

revoke all on public.session_likes from anon, authenticated;
grant select, insert, delete on public.session_likes to anon, authenticated;

revoke all on public.event_counts from anon, authenticated;
grant execute on function public.track_event(text) to anon, authenticated;

drop policy if exists "sessions read active" on public.sessions;
create policy "sessions read active" on public.sessions
  for select using (expires_at > now());
drop policy if exists "sessions create" on public.sessions;
create policy "sessions create" on public.sessions
  for insert with check (true);
drop policy if exists "sessions update active" on public.sessions;
create policy "sessions update active" on public.sessions
  for update using (expires_at > now()) with check (expires_at > now());

drop policy if exists "members read" on public.session_members;
create policy "members read" on public.session_members
  for select using (public.session_is_active(code));
drop policy if exists "members join" on public.session_members;
create policy "members join" on public.session_members
  for insert with check (public.session_is_active(code) and public.session_member_count(code) < 6);
drop policy if exists "members update" on public.session_members;
create policy "members update" on public.session_members
  for update using (public.session_is_active(code)) with check (public.session_is_active(code));

drop policy if exists "likes read" on public.session_likes;
create policy "likes read" on public.session_likes
  for select using (public.session_is_active(code));
drop policy if exists "likes add" on public.session_likes;
create policy "likes add" on public.session_likes
  for insert with check (
    public.session_is_active(code)
    and exists (select 1 from public.session_members m where m.code = session_likes.code and m.member_id = session_likes.member_id)
  );
drop policy if exists "likes remove" on public.session_likes;
create policy "likes remove" on public.session_likes
  for delete using (public.session_is_active(code));

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.sessions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.session_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.session_likes; exception when duplicate_object then null; end;
  end if;
end $$;

-- ───────────────────────── Storage (restaurant data + cached photos) ─────────────────────────
-- Both buckets are public-read; only Edge Functions (service role) write to them.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('data', 'data', true) on conflict (id) do update set public = true;
    insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do update set public = true;
  end if;
end $$;
