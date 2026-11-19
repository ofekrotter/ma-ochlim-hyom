/*
# Lock down public access before a public launch

The anon key is in the browser, so anything granted to `anon` is public.
This migration:

- Drops direct table access for friend rooms. Clients use the room RPCs below.
  A room code (8 characters for new rooms; existing 4-character codes still open
  until they expire) is the read capability. Writes also need the member token
  the browser keeps locally. Nobody can list every active room anymore.
- Moves trigger/helper functions into schema `private`, which PostgREST does not
  expose, and revokes execute from anon/authenticated.
- Keeps `track_event` callable, but only for a short allow-list. Anything else
  is a no-op.
- Adds an explicit deny policy on `event_counts` (RLS with no policy was flagged).
- Adds `ops_counters` for the edge functions: admin-password lockout and the
  daily caps on Google photo fetches and seeds. Only the service role can touch it.
- Adds a private Storage bucket `data-private` for restaurants.full.json so photo
  resource names are not on a public URL. The photo function falls back to the
  old public file until the next seed.

Do not grant anon execute on `consume_daily_slot`. The photo/seed/stats functions
call it with the service role.

Apply this file in the Supabase SQL editor (or `supabase db push`) BEFORE deploying
the updated edge functions. It is not applied automatically by this repo.
*/

-- ───────────────────────── Private schema (not in the Data API) ─────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
$$;

create or replace function private.assert_room_code(p_code text, p_allow_legacy boolean)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_code is null then
    raise exception 'invalid';
  end if;
  if p_allow_legacy then
    if p_code !~ '^[A-Z2-9]{4}$' and p_code !~ '^[A-Z2-9]{8}$' then
      raise exception 'invalid';
    end if;
  elsif p_code !~ '^[A-Z2-9]{8}$' then
    raise exception 'invalid';
  end if;
end;
$$;

-- Rejects oversized or unexpected settings. Friend mode only stores a search point,
-- filters, and a deck of place ids — never a name, phone, or email.
create or replace function private.assert_settings(p jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  loc jsonb;
  n numeric;
  c text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4000 then
    raise exception 'invalid';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mode', 'location', 'radius', 'prices', 'cuisines', 'minRating', 'sort') then
      raise exception 'invalid';
    end if;
  end loop;
  if coalesce(p->>'mode', 'friend') not in ('solo', 'friend') then
    raise exception 'invalid';
  end if;
  if p->'radius' is null or jsonb_typeof(p->'radius') <> 'number' then
    raise exception 'invalid';
  end if;
  n := (p->>'radius')::numeric;
  if n < 500 or n > 5000 or n <> trunc(n) then
    raise exception 'invalid';
  end if;
  if p->'prices' is null or jsonb_typeof(p->'prices') <> 'array' or jsonb_array_length(p->'prices') > 3 then
    raise exception 'invalid';
  end if;
  for c in select jsonb_array_elements_text(p->'prices') loop
    if c not in ('1', '2', '3') then
      raise exception 'invalid';
    end if;
  end loop;
  if p->'cuisines' is null or jsonb_typeof(p->'cuisines') <> 'array' or jsonb_array_length(p->'cuisines') > 10 then
    raise exception 'invalid';
  end if;
  for c in select jsonb_array_elements_text(p->'cuisines') loop
    if c not in (
      'italian', 'pizza', 'sushi', 'burger', 'asian', 'middle_eastern', 'meat', 'vegetarian', 'cafe', 'other'
    ) then
      raise exception 'invalid';
    end if;
  end loop;
  if p ? 'minRating' and p->'minRating' <> 'null'::jsonb then
    if jsonb_typeof(p->'minRating') <> 'number' then
      raise exception 'invalid';
    end if;
    n := (p->>'minRating')::numeric;
    if n < 0 or n > 5 then
      raise exception 'invalid';
    end if;
  end if;
  if p ? 'sort' and nullif(p->>'sort', '') is not null and p->>'sort' not in ('mixed', 'nearest') then
    raise exception 'invalid';
  end if;
  if p->'location' is null or jsonb_typeof(p->'location') <> 'object' then
    raise exception 'invalid';
  end if;
  loc := p->'location';
  for k in select jsonb_object_keys(loc) loop
    if k not in ('lat', 'lng', 'label', 'source', 'areaId') then
      raise exception 'invalid';
    end if;
  end loop;
  if jsonb_typeof(loc->'lat') <> 'number' or jsonb_typeof(loc->'lng') <> 'number' then
    raise exception 'invalid';
  end if;
  n := (loc->>'lat')::numeric;
  if n < -90 or n > 90 then raise exception 'invalid'; end if;
  n := (loc->>'lng')::numeric;
  if n < -180 or n > 180 then raise exception 'invalid'; end if;
  if loc->>'label' is null or char_length(loc->>'label') < 1 or char_length(loc->>'label') > 80 then
    raise exception 'invalid';
  end if;
  if loc->>'source' not in ('gps', 'area') then
    raise exception 'invalid';
  end if;
  if loc ? 'areaId' and nullif(loc->>'areaId', '') is not null then
    if loc->>'areaId' !~ '^[a-z0-9-]{1,40}$' then
      raise exception 'invalid';
    end if;
  end if;
end;
$$;

create or replace function private.assert_deck(p text[])
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  id text;
begin
  if p is null or cardinality(p) < 1 or cardinality(p) > 120 then
    raise exception 'invalid';
  end if;
  foreach id in array p loop
    if id is null or id !~ '^[A-Za-z0-9_-]{1,128}$' then
      raise exception 'invalid';
    end if;
  end loop;
end;
$$;

create or replace function private.assert_member(p_code text, p_member_id uuid, p_token text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.assert_room_code(p_code, true);
  if p_member_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.sessions s where s.code = p_code and s.expires_at > now()) then
    raise exception 'not-found';
  end if;
  if not exists (
    select 1 from public.session_members m
    where m.code = p_code and m.member_id = p_member_id and m.token_hash = private.token_hash(p_token)
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function private.delete_expired_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sessions where expires_at < now() - interval '1 day';
end;
$$;

-- Fired by inserts. Not an RPC: anon cannot execute it, and the trigger runs as the owner.
create or replace function private.cleanup_expired_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.delete_expired_sessions();
  return new;
end;
$$;

-- Best-effort live ping. Failure must not block the write. Polling still refreshes the room.
create or replace function private.notify_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := coalesce(new.code, old.code);
  perform realtime.send(
    jsonb_build_object('code', v_code),
    'tick',
    'room:' || v_code,
    false
  );
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ───────────────────────── Columns and checks ─────────────────────────
alter table public.session_members add column if not exists token_hash text;
alter table public.session_members drop constraint if exists session_members_token_hash_len;
alter table public.session_members
  add constraint session_members_token_hash_len
  check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');

-- The original inline check only allowed 4 characters. Drop whatever it was named.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'sessions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%code ~%'
  loop
    execute format('alter table public.sessions drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.sessions
  add constraint sessions_code_check
  check (code ~ '^[A-Z2-9]{4}$' or code ~ '^[A-Z2-9]{8}$');

alter table public.sessions drop constraint if exists sessions_settings_size;
alter table public.sessions
  add constraint sessions_settings_size
  check (octet_length(settings::text) <= 4000);

create index if not exists sessions_created_idx on public.sessions (created_at);

-- ───────────────────────── Close the tables ─────────────────────────
drop policy if exists "sessions read active" on public.sessions;
drop policy if exists "sessions create" on public.sessions;
drop policy if exists "sessions update active" on public.sessions;
drop policy if exists "members read" on public.session_members;
drop policy if exists "members join" on public.session_members;
drop policy if exists "members update" on public.session_members;
drop policy if exists "likes read" on public.session_likes;
drop policy if exists "likes add" on public.session_likes;
drop policy if exists "likes remove" on public.session_likes;

revoke all on public.sessions from public, anon, authenticated;
revoke all on public.session_members from public, anon, authenticated;
revoke all on public.session_likes from public, anon, authenticated;
revoke all on public.event_counts from public, anon, authenticated;

-- Restrictive deny: a later permissive policy cannot reopen these tables to the browser.
drop policy if exists "no client access" on public.sessions;
create policy "no client access" on public.sessions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "no client access" on public.session_members;
create policy "no client access" on public.session_members
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "no client access" on public.session_likes;
create policy "no client access" on public.session_likes
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "no client access" on public.event_counts;
create policy "no client access" on public.event_counts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

grant select, insert, update, delete on public.sessions to service_role;
grant select, insert, update, delete on public.session_members to service_role;
grant select, insert, update, delete on public.session_likes to service_role;
grant select, insert, update, delete on public.event_counts to service_role;

-- ───────────────────────── Drop the old public helpers ─────────────────────────
drop trigger if exists sessions_cleanup on public.sessions;
drop function if exists public.cleanup_expired_sessions();
drop function if exists public.session_is_active(text);
drop function if exists public.session_member_count(text);

drop trigger if exists sessions_cleanup on public.sessions;
create trigger sessions_cleanup
  after insert on public.sessions
  for each statement execute function private.cleanup_expired_sessions();

drop trigger if exists rooms_notify_sessions on public.sessions;
create trigger rooms_notify_sessions
  after insert or update or delete on public.sessions
  for each row execute function private.notify_room();

drop trigger if exists rooms_notify_members on public.session_members;
create trigger rooms_notify_members
  after insert or update or delete on public.session_members
  for each row execute function private.notify_room();

drop trigger if exists rooms_notify_likes on public.session_likes;
create trigger rooms_notify_likes
  after insert or update or delete on public.session_likes
  for each row execute function private.notify_room();

-- ───────────────────────── Room RPCs (intentional public API) ─────────────────────────
create or replace function public.create_friend_session(p_code text, p_settings jsonb, p_deck text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sessions%rowtype;
begin
  perform private.assert_room_code(p_code, false);
  perform private.assert_settings(p_settings);
  perform private.assert_deck(p_deck);
  perform private.delete_expired_sessions();
  if (select count(*) from public.sessions) >= 8000 then
    raise exception 'busy';
  end if;
  -- Caps a script filling the free database. A normal launch stays far under this.
  if (select count(*) from public.sessions where created_at > now() - interval '1 hour') >= 400 then
    raise exception 'busy';
  end if;
  insert into public.sessions (code, settings, deck)
  values (p_code, p_settings, p_deck)
  returning * into s;
  return jsonb_build_object(
    'code', s.code,
    'settings', s.settings,
    'deck', to_jsonb(s.deck),
    'round', s.round,
    'created_at', s.created_at,
    'expires_at', s.expires_at
  );
end;
$$;

create or replace function public.get_friend_state(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sessions%rowtype;
begin
  begin
    perform private.assert_room_code(p_code, true);
  exception when others then
    return null;
  end;
  select * into s from public.sessions where code = p_code and expires_at > now();
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'session', jsonb_build_object(
      'code', s.code,
      'settings', s.settings,
      'deck', to_jsonb(s.deck),
      'round', s.round,
      'created_at', s.created_at,
      'expires_at', s.expires_at
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', m.code,
        'member_id', m.member_id,
        'is_creator', m.is_creator,
        'round', m.round,
        'progress', m.progress,
        'finished', m.finished,
        'last_seen', m.last_seen,
        'joined_at', m.joined_at
      ) order by m.joined_at)
      from public.session_members m
      where m.code = s.code
    ), '[]'::jsonb),
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code,
        'member_id', l.member_id,
        'round', l.round,
        'place_id', l.place_id,
        'created_at', l.created_at
      ) order by l.created_at)
      from public.session_likes l
      where l.code = s.code
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.join_friend_session(
  p_code text,
  p_member_id uuid,
  p_is_creator boolean,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_round int;
begin
  perform private.assert_room_code(p_code, true);
  if p_member_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'forbidden';
  end if;
  v_hash := private.token_hash(p_token);
  perform pg_advisory_xact_lock(hashtext('room:' || p_code)::bigint);
  select round into v_round from public.sessions where code = p_code and expires_at > now();
  if not found then
    raise exception 'not-found';
  end if;

  if exists (
    select 1 from public.session_members
    where code = p_code and member_id = p_member_id and token_hash = v_hash
  ) then
    update public.session_members set last_seen = now()
    where code = p_code and member_id = p_member_id;
    return;
  end if;

  -- Rooms created before tokens existed: the first browser to present this member id claims it.
  update public.session_members
    set token_hash = v_hash, last_seen = now()
    where code = p_code and member_id = p_member_id and token_hash is null;
  if found then
    return;
  end if;

  if exists (select 1 from public.session_members where code = p_code and member_id = p_member_id) then
    raise exception 'forbidden';
  end if;

  if (select count(*) from public.session_members where code = p_code) >= 6 then
    raise exception 'full';
  end if;

  insert into public.session_members (code, member_id, is_creator, round, token_hash)
  values (
    p_code,
    p_member_id,
    p_is_creator is true and not exists (
      select 1 from public.session_members m where m.code = p_code and m.is_creator
    ),
    v_round,
    v_hash
  );
exception
  when unique_violation then
    if exists (
      select 1 from public.session_members
      where code = p_code and member_id = p_member_id and token_hash = v_hash
    ) then
      return;
    end if;
    if (select count(*) from public.session_members where code = p_code) >= 6 then
      raise exception 'full';
    end if;
    raise exception 'forbidden';
end;
$$;

create or replace function public.update_friend_member(
  p_code text,
  p_member_id uuid,
  p_token text,
  p_round int,
  p_progress int,
  p_finished boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
begin
  perform private.assert_member(p_code, p_member_id, p_token);
  select round into v_round from public.sessions where code = p_code;
  if p_round is not null and (p_round < 1 or p_round > v_round or p_round > 50) then
    raise exception 'invalid';
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 200) then
    raise exception 'invalid';
  end if;
  update public.session_members
    set last_seen = now(),
        round = coalesce(p_round, round),
        progress = coalesce(p_progress, progress),
        finished = coalesce(p_finished, finished)
    where code = p_code and member_id = p_member_id and token_hash = private.token_hash(p_token);
  if not found then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function public.like_friend_place(
  p_code text,
  p_member_id uuid,
  p_token text,
  p_round int,
  p_place_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
begin
  perform private.assert_member(p_code, p_member_id, p_token);
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'invalid';
  end if;
  select round into v_round from public.sessions where code = p_code;
  if p_round is null or p_round < 1 or p_round > v_round then
    raise exception 'invalid';
  end if;
  if (
    select count(*) from public.session_likes
    where code = p_code and member_id = p_member_id and round = p_round
  ) >= 120 then
    return;
  end if;
  insert into public.session_likes (code, member_id, round, place_id)
  values (p_code, p_member_id, p_round, p_place_id)
  on conflict do nothing;
end;
$$;

create or replace function public.unlike_friend_place(
  p_code text,
  p_member_id uuid,
  p_token text,
  p_round int,
  p_place_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.assert_member(p_code, p_member_id, p_token);
  if p_place_id is null or char_length(p_place_id) > 128 then
    raise exception 'invalid';
  end if;
  delete from public.session_likes
  where code = p_code and member_id = p_member_id and round = p_round and place_id = p_place_id;
end;
$$;

create or replace function public.advance_friend_round(
  p_code text,
  p_member_id uuid,
  p_token text,
  p_expected_round int,
  p_settings jsonb,
  p_deck text[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.assert_member(p_code, p_member_id, p_token);
  perform private.assert_settings(p_settings);
  perform private.assert_deck(p_deck);
  if p_expected_round is null or p_expected_round < 1 or p_expected_round >= 50 then
    raise exception 'invalid';
  end if;
  update public.sessions
    set round = p_expected_round + 1,
        settings = p_settings,
        deck = p_deck
    where code = p_code and round = p_expected_round and expires_at > now();
  return found;
end;
$$;

-- Allow-listed funnel counter. The only client write to event_counts.
create or replace function public.track_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event is null or char_length(p_event) > 40 or p_event !~ '^[a-z0-9_]{1,40}$' then
    return;
  end if;
  if p_event not in (
    'app_open', 'cta_click', 'mode_selected_solo', 'mode_selected_friend', 'location_set', 'price_selected',
    'cuisine_selected', 'first_swipe', 'swipe_like', 'swipe_skip', 'session_created', 'friend_joined',
    'match_found', 'navigate_clicked', 'share_clicked', 'solo_result'
  ) then
    return;
  end if;
  insert into public.event_counts (day, event, count)
  values ((now() at time zone 'Asia/Jerusalem')::date, p_event, 1)
  on conflict (day, event) do update set count = public.event_counts.count + 1;
end;
$$;

-- Service-role only. Photo and seed functions spend this before calling Google.
-- Table first: the function body runs later, but keeping the order obvious avoids a miss.
create table if not exists public.ops_counters (
  bucket text primary key check (char_length(bucket) between 1 and 80),
  n integer not null default 0 check (n >= 0),
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

create or replace function public.consume_daily_slot(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9:_-]{1,80}$' then
    return false;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    return false;
  end if;
  insert into public.ops_counters as c (bucket, n, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set n = c.n + 1
    where c.n < p_limit
  returning n into v_n;
  return v_n is not null;
end;
$$;

revoke all on function public.create_friend_session(text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.get_friend_state(text) from public, anon, authenticated;
revoke all on function public.join_friend_session(text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.update_friend_member(text, uuid, text, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.like_friend_place(text, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.unlike_friend_place(text, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.advance_friend_round(text, uuid, text, integer, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.track_event(text) from public, anon, authenticated;
revoke all on function public.consume_daily_slot(text, integer) from public, anon, authenticated;

grant execute on function public.create_friend_session(text, jsonb, text[]) to anon, authenticated;
grant execute on function public.get_friend_state(text) to anon, authenticated;
grant execute on function public.join_friend_session(text, uuid, boolean, text) to anon, authenticated;
grant execute on function public.update_friend_member(text, uuid, text, integer, integer, boolean) to anon, authenticated;
grant execute on function public.like_friend_place(text, uuid, text, integer, text) to anon, authenticated;
grant execute on function public.unlike_friend_place(text, uuid, text, integer, text) to anon, authenticated;
grant execute on function public.advance_friend_round(text, uuid, text, integer, jsonb, text[]) to anon, authenticated;
grant execute on function public.track_event(text) to anon, authenticated;
grant execute on function public.consume_daily_slot(text, integer) to service_role;

comment on function public.track_event(text) is
  'Intentional public RPC. Allow-listed short event names only; anything else is ignored. Counts are anonymous aggregates.';
comment on function public.get_friend_state(text) is
  'Intentional public RPC. Returns one active room when the caller already knows its code. Does not list rooms.';
comment on function public.consume_daily_slot(text, integer) is
  'Service role only. Atomic daily cap used before paid Google Places calls.';

-- ───────────────────────── Ops counters (admin lockout + Google caps) ─────────────────────────
alter table public.ops_counters enable row level security;
revoke all on public.ops_counters from public, anon, authenticated;
grant select, insert, update, delete on public.ops_counters to service_role;
drop policy if exists "no client access" on public.ops_counters;
create policy "no client access" on public.ops_counters
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- ───────────────────────── Private copy of the photo manifest ─────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public)
    values ('data-private', 'data-private', false)
    on conflict (id) do update set public = false;
  end if;
end $$;
