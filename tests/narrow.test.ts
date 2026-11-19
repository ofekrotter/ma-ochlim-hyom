import { describe, expect, it } from 'vitest';
import {
  MUTUAL_TARGET,
  PICK_CAP,
  SHORTLIST_MAX,
  candidatePlaceIds,
  fallbackShortlist,
  friendPhase,
  likesNeeded,
  memberIsAway,
  narrowVoteRound,
  VOTE_AWAY_MS,
  resolveVotes,
  sanitizePicks,
  uniqueIds,
  votersForDecision,
  votesFromLikes,
  type PhaseInput,
  type Voter,
} from '../src/lib/narrow.ts';

function phase(over: Partial<PhaseInput> = {}) {
  return friendPhase({
    mutualIds: [],
    iStopped: false,
    friendStillSwiping: true,
    friendStopped: false,
    ...over,
  });
}

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('friendPhase', () => {
  it('keeps swiping on any number of mutual likes while I still have cards', () => {
    expect(phase({ mutualIds: ['a'] })).toEqual({ kind: 'swipe' });
    expect(phase({ mutualIds: ['a', 'b', 'c'] })).toEqual({ kind: 'swipe' });
  });

  it('never interrupts me mid-deck, even at MUTUAL_TARGET shared likes (the "top 5" bug)', () => {
    expect(MUTUAL_TARGET).toBeGreaterThan(SHORTLIST_MAX);
    const mutualIds = ids.slice(0, MUTUAL_TARGET);
    expect(phase({ mutualIds })).toEqual({ kind: 'swipe' });
    expect(phase({ mutualIds: ids })).toEqual({ kind: 'swipe' });
    // my friend finished — I still get to finish my own deck
    expect(phase({ mutualIds, friendStopped: true, friendStillSwiping: false })).toEqual({ kind: 'swipe' });
    expect(phase({ mutualIds: ['a'], friendStopped: true, friendStillSwiping: false })).toEqual({ kind: 'swipe' });
  });

  it('does not pull the other person off the deck when there is nothing in common yet', () => {
    expect(phase({ friendStopped: true, friendStillSwiping: false })).toEqual({ kind: 'swipe' });
  });

  it('holds what we have while the friend is still swiping', () => {
    expect(phase({ mutualIds: ids.slice(0, 5), iStopped: true })).toEqual({ kind: 'holding', ids: ids.slice(0, 5) });
    expect(phase({ mutualIds: ['a'], iStopped: true })).toEqual({ kind: 'holding', ids: ['a'] });
  });

  it('shows 1–3 mutuals directly once everyone stopped', () => {
    const done = { iStopped: true, friendStillSwiping: false, friendStopped: true };
    expect(phase({ mutualIds: ['a'], ...done })).toEqual({ kind: 'final', ids: ['a'] });
    expect(phase({ mutualIds: ['a', 'b'], ...done })).toEqual({ kind: 'final', ids: ['a', 'b'] });
    expect(phase({ mutualIds: ['c', 'a', 'b'], ...done })).toEqual({ kind: 'final', ids: ['c', 'a', 'b'] });
  });

  it('opens a re-vote only when everyone stopped with more than 3 mutuals', () => {
    expect(phase({ mutualIds: ids.slice(0, 4), iStopped: true, friendStillSwiping: false })).toEqual({
      kind: 'narrow',
      ids: ids.slice(0, 4),
    });
    expect(phase({ mutualIds: ids.slice(0, 4), iStopped: true, friendStillSwiping: true }).kind).toBe('holding');
  });

  it('waits when I stopped and my friend is still swiping with nothing in common', () => {
    expect(phase({ iStopped: true, friendStillSwiping: true })).toEqual({ kind: 'waiting' });
  });

  it('shows an empty ending when nobody is left to create a mutual like', () => {
    expect(phase({ iStopped: true, friendStillSwiping: false, friendStopped: true })).toEqual({ kind: 'empty' });
    expect(phase({ iStopped: true, friendStillSwiping: false, friendStopped: false })).toEqual({ kind: 'empty' });
  });

  it('drops duplicate ids and keeps deck order', () => {
    expect(phase({ mutualIds: ['b', 'a', 'b', ''], iStopped: true, friendStillSwiping: false })).toEqual({
      kind: 'final',
      ids: ['b', 'a'],
    });
    expect(uniqueIds(['b', 'a', 'b', ''])).toEqual(['b', 'a']);
  });
});

describe('narrowing votes', () => {
  it('stores votes on a round that cannot collide with a swipe round', () => {
    for (let round = 1; round <= 50; round++) {
      const voteRound = narrowVoteRound(round);
      expect(voteRound).toBeGreaterThan(50);
      expect(voteRound).not.toBe(round);
    }
    expect(narrowVoteRound(1)).toBe(101);
    expect(narrowVoteRound(50)).toBe(150);
    expect(narrowVoteRound(4, 2)).toBe(204);
  });

  it('reads only the vote round and caps each person at 3, in deck order', () => {
    const likes = [
      { member_id: 'me', round: 1, place_id: 'a' },
      { member_id: 'me', round: 101, place_id: 'e' },
      { member_id: 'me', round: 101, place_id: 'a' },
      { member_id: 'me', round: 101, place_id: 'c' },
      { member_id: 'me', round: 101, place_id: 'b' },
      { member_id: 'me', round: 101, place_id: 'nope' },
      { member_id: 'pal', round: 101, place_id: 'd' },
    ];
    const map = votesFromLikes(likes, narrowVoteRound(1), ids);
    expect(map.get('me')).toEqual(['a', 'b', 'c']);
    expect(map.get('pal')).toEqual(['d']);
    expect(sanitizePicks(ids, ['f', 'f', 'a', 'missing'])).toEqual(['a', 'f']);
    expect(PICK_CAP).toBe(3);
  });

  it('waits for my pick, then for a friend who has not voted', () => {
    const mutual = ids.slice(0, 4);
    const voters: Voter[] = [
      { memberId: 'me', picks: null, required: true },
      { memberId: 'pal', picks: null, required: true },
    ];
    expect(resolveVotes(mutual, voters, 'me').status).toBe('picking');
    voters[0] = { memberId: 'me', picks: ['b', 'c'], required: true };
    expect(resolveVotes(mutual, voters, 'me')).toEqual({ status: 'waiting', ids: ['b', 'c'], kind: null });
    voters[1] = { memberId: 'pal', picks: ['b'], required: true };
    expect(resolveVotes(mutual, voters, 'me')).toEqual({ status: 'ready', ids: ['b'], kind: 'agreement' });
  });

  it('keeps the overlap when both picked some of the same places', () => {
    const mutual = ids.slice(0, 5);
    const voters: Voter[] = [
      { memberId: 'me', picks: ['a', 'c', 'e'], required: true },
      { memberId: 'pal', picks: ['b', 'c'], required: true },
    ];
    expect(resolveVotes(mutual, voters, 'me')).toEqual({ status: 'ready', ids: ['c'], kind: 'agreement' });
  });

  it('uses the most-picked places when there is no overlap', () => {
    const mutual = ['a', 'b', 'c', 'd', 'e', 'f'];
    const voters: Voter[] = [
      { memberId: 'me', picks: ['a', 'b', 'c'], required: true },
      { memberId: 'pal', picks: ['d', 'e', 'f'], required: true },
    ];
    expect(resolveVotes(mutual, voters, 'me')).toEqual({
      status: 'ready',
      ids: ['a', 'b', 'c'],
      kind: 'compromise',
    });
  });

  it('ranks a 2-vote place ahead of a 1-vote place, then deck order', () => {
    const mutual = ['a', 'b', 'c', 'd'];
    const voters: Voter[] = [
      { memberId: 'me', picks: ['a', 'c'], required: true },
      { memberId: 'pal', picks: ['b', 'c'], required: true },
      { memberId: 'third', picks: ['b', 'd'], required: true },
    ];
    const result = resolveVotes(mutual, voters, 'me');
    expect(result.kind).toBe('compromise');
    expect(result.ids).toEqual(['b', 'c', 'a']);
  });

  it('lets the remaining person decide when the friend has left', () => {
    const mutual = ids.slice(0, 4);
    const others = [{ memberId: 'pal', online: false, picks: null }];
    const waiting = votersForDecision({ selfId: 'me', selfPicks: ['a', 'd'], others, decideAlone: false });
    expect(resolveVotes(mutual, waiting, 'me').status).toBe('waiting');

    const alone = votersForDecision({ selfId: 'me', selfPicks: ['d', 'a', 'a'], others, decideAlone: true });
    expect(resolveVotes(mutual, alone, 'me')).toEqual({ status: 'ready', ids: ['a', 'd'], kind: 'solo' });
  });

  it('still counts a vote the friend sent before going offline', () => {
    const mutual = ids.slice(0, 4);
    const voters = votersForDecision({
      selfId: 'me',
      selfPicks: ['a', 'b'],
      others: [{ memberId: 'pal', online: false, picks: ['b', 'c'] }],
      decideAlone: true,
    });
    expect(resolveVotes(mutual, voters, 'me')).toEqual({ status: 'ready', ids: ['b'], kind: 'agreement' });
  });

  it('does not treat a background tab as gone until several minutes pass', () => {
    const now = Date.parse('2026-11-19T10:00:00.000Z');
    expect(memberIsAway(new Date(now - 30_000).toISOString(), now)).toBe(false);
    expect(memberIsAway(new Date(now - 90_000).toISOString(), now)).toBe(false);
    expect(memberIsAway(new Date(now - VOTE_AWAY_MS - 1).toISOString(), now)).toBe(true);
    expect(memberIsAway('not-a-date', now)).toBe(false);
  });

  it('a pair needs both likes, a group needs a strict majority, in deck order', () => {
    expect(likesNeeded(1)).toBe(2);
    expect(likesNeeded(2)).toBe(2);
    expect(likesNeeded(3)).toBe(2);
    expect(likesNeeded(4)).toBe(3);
    expect(likesNeeded(5)).toBe(3);
    expect(likesNeeded(6)).toBe(4);
    const deck = ['a', 'b', 'c'];
    const likes = new Map<string, Set<string>>([
      ['m1', new Set(['a', 'b'])],
      ['m2', new Set(['a'])],
      ['m3', new Set(['b', 'c'])],
      ['m4', new Set(['a', 'b'])],
    ]);
    expect(candidatePlaceIds(deck, likes, ['m1', 'm2'])).toEqual(['a']);
    expect(candidatePlaceIds(deck, likes, ['m1', 'm2', 'm3'])).toEqual(['a', 'b']);
    expect(candidatePlaceIds(deck, likes, ['m1', 'm2', 'm3', 'm4'])).toEqual(['a', 'b']);
  });

  it('one person tapping finish does not end a group of three', () => {
    expect(
      friendPhase({
        mutualIds: ['a', 'b'],
        iStopped: true,
        friendStillSwiping: true,
        friendStopped: false,
        memberCount: 3,
        stoppedCount: 1,
      }),
    ).toEqual({ kind: 'holding', ids: ['a', 'b'] });
  });

  it('a group narrows only after everyone stopped, never on five shared places or a majority', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    // majority stopped, one still swiping → hold, do not lock
    expect(
      friendPhase({ mutualIds: ['a', 'b'], iStopped: true, friendStillSwiping: true, friendStopped: true, memberCount: 3, stoppedCount: 2 }),
    ).toEqual({ kind: 'holding', ids: ['a', 'b'] });
    // five shared places while members are mid-deck → everyone keeps swiping
    expect(
      friendPhase({ mutualIds: five, iStopped: false, friendStillSwiping: true, friendStopped: false, memberCount: 6, stoppedCount: 0 }),
    ).toEqual({ kind: 'swipe' });
    // the last member still swiping is never yanked, even when all others finished
    expect(
      friendPhase({ mutualIds: five, iStopped: false, friendStillSwiping: false, friendStopped: true, memberCount: 4, stoppedCount: 3 }),
    ).toEqual({ kind: 'swipe' });
    // everyone done
    expect(
      friendPhase({ mutualIds: ['a', 'b'], iStopped: true, friendStillSwiping: false, friendStopped: true, memberCount: 3, stoppedCount: 3 }),
    ).toEqual({ kind: 'final', ids: ['a', 'b'] });
    expect(
      friendPhase({ mutualIds: five, iStopped: true, friendStillSwiping: false, friendStopped: true, memberCount: 6, stoppedCount: 6 }),
    ).toEqual({ kind: 'narrow', ids: five });
  });

  it('falls back to the best-supported 1–3 mutuals when votes cannot be saved', () => {
    expect(fallbackShortlist(ids)).toEqual(['a', 'b', 'c']);
    expect(fallbackShortlist(['only'])).toEqual(['only']);
    expect(fallbackShortlist([])).toEqual([]);
    const likeCounts = new Map([['a', 2], ['b', 2], ['c', 2], ['d', 3], ['e', 3]]);
    expect(fallbackShortlist(ids, likeCounts)).toEqual(['d', 'e', 'a']);
    const votes = new Map([['me', ['f', 'c']], ['pal', ['f']]]);
    expect(fallbackShortlist(ids, likeCounts, votes)).toEqual(['f', 'c', 'd']);
  });
});

describe('narrowing votes reach the database', () => {
  // Mirror of the like_friend_place round check in
  // supabase/migrations/20261119160000_allow_narrowing_votes.sql.
  const accepted = (pRound: number, sessionRound: number) =>
    (pRound >= 1 && pRound <= sessionRound) || (pRound >= 100 && pRound <= 999 && pRound % 100 === sessionRound);

  it('every vote round the app writes is accepted for the current swipe round', () => {
    for (let round = 1; round <= 50; round++) {
      expect(accepted(round, round)).toBe(true);
      expect(accepted(narrowVoteRound(round), round)).toBe(true);
    }
  });

  it('stale or arbitrary rounds stay rejected', () => {
    expect(accepted(narrowVoteRound(1), 2)).toBe(false);
    expect(accepted(3, 2)).toBe(false);
    expect(accepted(0, 2)).toBe(false);
    expect(accepted(99, 2)).toBe(false);
    expect(accepted(1002, 2)).toBe(false);
  });

  it('the migration file keeps the security-definer token check and accepts vote rounds', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/20261119160000_allow_narrowing_votes.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/private\.assert_member\(p_code, p_member_id, p_token\)/);
    expect(sql).toMatch(/p_round between 100 and 999 and p_round % 100 = v_round/);
  });
});
