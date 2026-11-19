-- Friend rooms: let the narrowing re-vote save again.
--
-- The app stores each member's 1–3 narrowing picks as session_likes rows on a
-- "vote round" = ballot * 100 + sessions.round (101, 102, … — see
-- src/lib/narrow.ts narrowVoteRound). The lock-down migration
-- (20261119140000) only accepted p_round between 1 and sessions.round, so
-- every vote was rejected with 'invalid' and nobody could pick anything on
-- the "בואו נצמצם" screen.
--
-- Same function, same SECURITY DEFINER + member-token check, same per-round
-- row cap. The only change: also accept the vote round(s) of the CURRENT
-- swipe round (ballot 1–9). Stale rounds and arbitrary numbers stay rejected.

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
  if p_round is null or v_round is null then
    raise exception 'invalid';
  end if;
  if not (
    (p_round between 1 and v_round)
    or (p_round between 100 and 999 and p_round % 100 = v_round)
  ) then
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

-- Unchanged grants, restated so this file is self-contained.
revoke all on function public.like_friend_place(text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.like_friend_place(text, uuid, text, integer, text) to anon, authenticated;
