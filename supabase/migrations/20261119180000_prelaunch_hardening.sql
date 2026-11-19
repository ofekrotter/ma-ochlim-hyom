-- Pre-launch hardening (no table changes, no grants change).
--
-- 1. Realtime pings: skip the "tick" when a session_members UPDATE only moves
--    last_seen (heartbeats, and a returning browser re-joining). Every member
--    used to re-fetch the whole room every 20 seconds per member. Presence is
--    still picked up by the 10-second poll. Any real change (round, progress,
--    finished, token, creator flag) still pings at once, as do all inserts and
--    deletes, and every change to sessions / session_likes.
--
-- 2. Photo budget: the photo function now counts Google downloads per billing
--    month in ops_counters bucket `photo:YYYY-MM` (US Pacific month, which is
--    when Google's free usage resets) instead of per UTC day. Carry over what
--    this month's daily buckets already spent so the first month is not
--    under-counted. consume_daily_slot itself is unchanged: it already works
--    for any bucket name and limit.

create or replace function private.notify_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'session_members'
     and (to_jsonb(new) - 'last_seen') = (to_jsonb(old) - 'last_seen') then
    return new;
  end if;
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

revoke all on function private.notify_room() from public, anon, authenticated;

-- Carry over this month's photo downloads from the old daily buckets (photo:YYYY-MM-DD).
insert into public.ops_counters (bucket, n, window_start)
select 'photo:' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM'),
       coalesce(sum(n), 0)::int,
       now()
from public.ops_counters
where bucket like 'photo:' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM') || '-%'
on conflict (bucket) do update
  set n = greatest(public.ops_counters.n, excluded.n);
