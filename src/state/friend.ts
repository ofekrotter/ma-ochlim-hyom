import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackOnce } from '../lib/analytics';
import { backend, SessionError, type SessionState } from '../lib/backend';
import { RADIUS_MAX } from '../lib/config';
import { buildDeck, deckFromIds } from '../lib/data';
import {
  fallbackShortlist,
  friendPhase,
  memberIsAway,
  narrowVoteRound,
  resolveVotes,
  sanitizePicks,
  votersForDecision,
  votesFromLikes,
  type FriendPhase,
  type VoteResolution,
} from '../lib/narrow';
import type { DeckCard, RestaurantData, Settings } from '../lib/types';
import type { Dir } from '../components/SwipeDeck';

const ONLINE_MS = 60_000;

// Identity store: localStorage in production (same person across tabs/refreshes).
// In local preview mode (no database) each tab is its own "person" so friend mode can be tried with two tabs.
const idStore = () => (backend.kind === 'local' ? sessionStorage : localStorage);

export function markCreator(code: string) {
  try {
    idStore().setItem(`mo:creator:${code}`, '1');
  } catch {
    /* ignore */
  }
}
function isCreatorHere(code: string) {
  try {
    return idStore().getItem(`mo:creator:${code}`) === '1';
  } catch {
    return false;
  }
}
function memberIdFor(code: string): string {
  const k = `mo:member:${code}`;
  try {
    let id = idStore().getItem(k);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
      idStore().setItem(k, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
function seenKey(code: string, round: number) {
  return `mo:seen:${code}:${round}`;
}
function getSeen(code: string, round: number): Set<string> {
  try {
    return new Set(JSON.parse(idStore().getItem(seenKey(code, round)) || '[]'));
  } catch {
    return new Set();
  }
}
function addSeen(code: string, round: number, id: string) {
  const s = getSeen(code, round);
  s.add(id);
  try {
    idStore().setItem(seenKey(code, round), JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export type FriendStatus = 'loading' | 'ready' | 'not_found' | 'full' | 'error';

export function useFriendSession(code: string, data: RestaurantData | null) {
  const memberId = useMemo(() => memberIdFor(code), [code]);
  const creator = useMemo(() => isCreatorHere(code), [code]);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<FriendStatus>('loading');
  const [offline, setOffline] = useState(false);
  // Own progress/likes are optimistic and local-first; server copy restores them after refresh.
  const [mine, setMine] = useState<{ round: number; progress: number; likes: Set<string> } | null>(null);
  const [history, setHistory] = useState<{ id: string; dir: Dir }[]>([]);
  // null = follow the server's finished flag. true/false are this tab's choice.
  const [stoppedEarly, setStoppedEarly] = useState<boolean | null>(null);
  const [localPicks, setLocalPicks] = useState<string[] | null>(null);
  const [decideAlone, setDecideAlone] = useState(false);
  const [pickError, setPickError] = useState(false);
  const [savingPicks, setSavingPicks] = useState(false);
  const [fallbackIds, setFallbackIds] = useState<string[] | null>(null);
  const joined = useRef(false);
  const lastLike = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await backend.getState(code);
      setOffline(false);
      if (!s) {
        setStatus('not_found');
        return;
      }
      setState(s);
      setStatus('ready');
    } catch {
      setOffline(true);
      setStatus((st) => (st === 'loading' ? 'error' : st));
    }
  }, [code]);

  // initial load + join
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await backend.getState(code);
        if (!alive) return;
        if (!s) return setStatus('not_found');
        const already = s.members.some((m) => m.member_id === memberId);
        if (!already) {
          try {
            await backend.join(code, memberId, creator);
          } catch (e) {
            if (e instanceof SessionError || (e as Error).message === 'full') return setStatus('full');
            throw e;
          }
          if (!creator) track('friend_joined', {});
        }
        joined.current = true;
        await refresh();
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, memberId, creator, refresh]);

  // realtime + polling fallback + reconnect handling
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (t) clearTimeout(t);
      t = setTimeout(refresh, 150);
    };
    const unsub = backend.subscribe(code, debounced);
    const poll = setInterval(() => document.visibilityState === 'visible' && refresh(), 10_000);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    const onOnline = () => refresh();
    const onOffline = () => setOffline(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsub();
      clearInterval(poll);
      if (t) clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [code, refresh]);

  const session = state?.session ?? null;
  const round = session?.round ?? 1;
  const me = state?.members.find((m) => m.member_id === memberId) ?? null;
  const others = (state?.members ?? []).filter((m) => m.member_id !== memberId);
  const friend = others.sort((a, b) => +new Date(b.last_seen) - +new Date(a.last_seen))[0] ?? null;

  // initialise / re-initialise own local state from the server (first load, refresh, new round)
  useEffect(() => {
    if (!state || !me) return;
    if (mine && mine.round === round) return;
    const myLikes = new Set(state.likes.filter((l) => l.member_id === memberId && l.round === round).map((l) => l.place_id));
    const progress = me.round === round ? me.progress : 0;
    setMine({ round, progress, likes: myLikes });
    setHistory([]);
    setStoppedEarly(null);
    setLocalPicks(null);
    setDecideAlone(false);
    setPickError(false);
    setFallbackIds(null);
  }, [state, me, mine, round, memberId]);

  // heartbeat (presence) every 20s
  useEffect(() => {
    if (status !== 'ready') return;
    const hb = setInterval(() => {
      if (joined.current && document.visibilityState === 'visible') backend.updateMember(code, memberId, {}).catch(() => setOffline(true));
    }, 20_000);
    return () => clearInterval(hb);
  }, [status, code, memberId]);

  const deck: DeckCard[] = useMemo(
    () => (data && session ? deckFromIds(data.restaurants, session.deck, session.settings) : []),
    [data, session],
  );

  // likes per place this round (server likes + my optimistic likes)
  const matches = useMemo(() => {
    if (!state || !mine) return [] as DeckCard[];
    const byPlace = new Map<string, Set<string>>();
    for (const l of state.likes) {
      if (l.round !== round || l.member_id === memberId) continue;
      if (!byPlace.has(l.place_id)) byPlace.set(l.place_id, new Set());
      byPlace.get(l.place_id)!.add(l.member_id);
    }
    return deck.filter((c) => mine.likes.has(c.id) && (byPlace.get(c.id)?.size ?? 0) >= 1);
  }, [state, mine, deck, round, memberId]);

  // A mutual like is counted once, quietly. It does not end the session.
  useEffect(() => {
    if (!mine) return;
    const seen = getSeen(code, round);
    const fresh = matches.filter((m) => !seen.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) {
      // Count the match once in aggregate stats: only for the member whose like came last (completed it).
      const likes = (state?.likes ?? []).filter((l) => l.round === round && l.place_id === m.id);
      const mineRow = likes.find((l) => l.member_id === memberId);
      const othersLatest = Math.max(0, ...likes.filter((l) => l.member_id !== memberId).map((l) => +new Date(l.created_at)));
      const completedByMe = !mineRow ? lastLike.current === m.id : +new Date(mineRow.created_at) >= othersLatest;
      track('match_found', { round, cuisine: m.cuisine }, { aggregate: completedByMe });
      addSeen(code, round, m.id);
    }
  }, [matches, mine, code, round, state, memberId]);

  const swipe = useCallback(
    (dir: Dir, card: DeckCard) => {
      if (!mine) return;
      const progress = mine.progress + 1;
      const finished = progress >= deck.length;
      const likes = new Set(mine.likes);
      if (dir === 'right') likes.add(card.id);
      setMine({ ...mine, progress, likes });
      setHistory((h) => [...h, { id: card.id, dir }].slice(-50));
      trackOnce('first_swipe', { mode: 'friend' }, 'first_swipe_friend');
      track(dir === 'right' ? 'swipe_like' : 'swipe_skip', { mode: 'friend', cuisine: card.cuisine });
      if (dir === 'right') {
        lastLike.current = card.id;
        // Re-read right after our like lands so a match is detected instantly even if realtime lags.
        backend.like(code, memberId, round, card.id).then(refresh, () => setOffline(true));
      }
      backend.updateMember(code, memberId, { round, progress, finished }).catch(() => setOffline(true));
    },
    [mine, deck.length, code, memberId, round, refresh],
  );

  const undo = useCallback((): { id: string; dir: Dir } | null => {
    if (!mine || mine.progress === 0) return null;
    const last = history[history.length - 1] ?? { id: deck[mine.progress - 1]?.id, dir: mine.likes.has(deck[mine.progress - 1]?.id) ? 'right' : 'left' };
    if (!last?.id) return null;
    const likes = new Set(mine.likes);
    likes.delete(last.id);
    const progress = mine.progress - 1;
    setMine({ ...mine, progress, likes });
    setHistory((h) => h.slice(0, -1));
    if (last.dir === 'right') backend.unlike(code, memberId, round, last.id).catch(() => undefined);
    setStoppedEarly(false);
    backend.updateMember(code, memberId, { round, progress, finished: false }).catch(() => undefined);
    return last as { id: string; dir: Dir };
  }, [mine, history, deck, code, memberId, round]);

  /** New round: 'widen' grows the radius (then drops price/cuisine filters), 'restart' reshuffles. */
  const newRound = useCallback(
    async (kind: 'widen' | 'restart') => {
      if (!session || !data) return false;
      let settings: Settings = session.settings;
      if (kind === 'widen') {
        settings =
          settings.radius < RADIUS_MAX
            ? { ...settings, radius: Math.min(RADIUS_MAX, settings.radius + 1500) }
            : { ...settings, prices: [], cuisines: [] };
      }
      const nextRound = session.round + 1;
      const ids = buildDeck(data.restaurants, settings, `${code}:${nextRound}`).map((r) => r.id);
      if (ids.length === 0) return false;
      const ok = await backend.advanceRound(code, session.round, settings, ids);
      await refresh();
      return ok;
    },
    [session, data, code, refresh],
  );

  const now = Date.now();
  const online = (seen: string) => now - new Date(seen).getTime() < ONLINE_MS;
  const friendInfo = friend
    ? {
        online: online(friend.last_seen),
        progress: friend.round === round ? friend.progress : 0,
        finished: friend.round === round && deck.length > 0 && (friend.finished || friend.progress >= deck.length),
      }
    : null;

  const deckDone = Boolean(mine && deck.length > 0 && mine.progress >= deck.length);
  const serverStopped = Boolean(me && me.round === round && me.finished);
  const iStopped = deckDone || (stoppedEarly === null ? serverStopped : stoppedEarly);
  const friendStopped =
    deck.length > 0 && others.some((m) => m.round === round && (m.finished || m.progress >= deck.length));
  const friendStillSwiping =
    deck.length > 0 &&
    others.some((m) => online(m.last_seen) && !(m.round === round && (m.finished || m.progress >= deck.length)));
  const mutualIds = matches.map((m) => m.id);
  const mutualKey = mutualIds.join('\0');
  const phase: FriendPhase = friendPhase({ mutualIds, iStopped, friendStillSwiping, friendStopped });

  const picksByMember = useMemo(
    () => votesFromLikes(state?.likes ?? [], narrowVoteRound(round), mutualKey ? mutualKey.split('\0') : []),
    [state?.likes, round, mutualKey],
  );
  const voters = votersForDecision({
    selfId: memberId,
    selfPicks: localPicks ?? picksByMember.get(memberId) ?? null,
    others: others.map((m) => ({
      memberId: m.member_id,
      online: online(m.last_seen),
      picks: picksByMember.get(m.member_id) ?? null,
    })),
    decideAlone,
  });
  const resolution: VoteResolution | null = phase.kind === 'narrow' && !fallbackIds ? resolveVotes(mutualIds, voters, memberId) : null;
  const pendingFriends = voters.filter((v) => v.required && v.memberId !== memberId && !v.picks).length;

  const stopSwiping = useCallback(() => {
    if (!mine) return;
    setFallbackIds(null);
    setStoppedEarly(true);
    backend.updateMember(code, memberId, { round, progress: mine.progress, finished: true }).catch(() => setOffline(true));
  }, [mine, code, memberId, round]);

  const resumeSwiping = useCallback(() => {
    if (!mine || (deck.length > 0 && mine.progress >= deck.length)) return;
    setFallbackIds(null);
    setLocalPicks(null);
    setDecideAlone(false);
    setStoppedEarly(false);
    const voteRound = narrowVoteRound(round);
    Promise.all(mutualIds.map((id) => backend.unlike(code, memberId, voteRound, id))).catch(() => undefined);
    backend.updateMember(code, memberId, { round, progress: mine.progress, finished: false }).catch(() => setOffline(true));
  }, [mine, deck.length, mutualIds, code, memberId, round]);

  const submitPicks = useCallback(
    async (ids: string[]) => {
      if (!mine) return;
      const clean = sanitizePicks(mutualIds, ids);
      if (clean.length === 0) return;
      const voteRound = narrowVoteRound(round);
      setSavingPicks(true);
      setPickError(false);
      setLocalPicks(clean);
      try {
        // Replace any earlier vote on this round so a retry doesn't union with a partial save.
        await Promise.all(mutualIds.map((id) => backend.unlike(code, memberId, voteRound, id)));
        await Promise.all(clean.map((id) => backend.like(code, memberId, voteRound, id)));
        await refresh();
      } catch {
        setLocalPicks(null);
        setPickError(true);
        setOffline(true);
      } finally {
        setSavingPicks(false);
      }
    },
    [mine, mutualIds, round, code, memberId, refresh],
  );

  const useFallback = useCallback(() => {
    const ids = fallbackShortlist(mutualIds);
    if (ids.length) setFallbackIds(ids);
  }, [mutualIds]);

  return {
    status,
    offline,
    session,
    deck,
    creator,
    memberId,
    friend: friendInfo,
    myProgress: mine?.progress ?? 0,
    myLikes: mine?.likes ?? new Set<string>(),
    ready: Boolean(mine && session && data),
    finished: deckDone,
    matches,
    phase,
    resolution,
    fallbackIds,
    pickError,
    savingPicks,
    pendingFriends,
    decideAlone,
    friendAway: Boolean(friend && memberIsAway(friend.last_seen, now)),
    swipe,
    undo,
    canUndo: Boolean(mine && mine.progress > 0),
    canResume: !deckDone && !friendStopped && !(phase.kind === 'narrow' && phase.reason === 'target'),
    stopSwiping,
    resumeSwiping,
    submitPicks,
    continueAlone: () => setDecideAlone(true),
    useFallback,
    newRound,
    refresh,
  };
}
