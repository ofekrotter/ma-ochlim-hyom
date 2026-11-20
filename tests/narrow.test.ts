import { describe, expect, it } from 'vitest';
import {
  activeMemberIds,
  canDecideWithout,
  syncPlan,
  MUTUAL_TARGET,
  PICK_CAP,
  SHORTLIST_MAX,
  candidatePlaceIds,
  fallbackShortlist,
  friendPhase,
  likesNeeded,
  memberIsAway,
  FINAL_VOTE_BALLOT,
  fallbackWinner,
  narrowVoteRound,
  pickWinnerFromTie,
  VOTE_AWAY_MS,
  resolveFinalVote,
  resolveFriendDecision,
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

  // QA: with no overlap every place had 1 vote, and deck order kept only one
  // person's picks. A tie at the cut now keeps every tied place.
  it('keeps every place tied at the cut instead of one person\'s picks', () => {
    const mutual = ['a', 'b', 'c', 'd', 'e', 'f'];
    const voters: Voter[] = [
      { memberId: 'me', picks: ['a', 'b', 'c'], required: true },
      { memberId: 'pal', picks: ['d', 'e', 'f'], required: true },
    ];
    expect(resolveVotes(mutual, voters, 'me')).toEqual({
      status: 'ready',
      ids: ['a', 'b', 'c', 'd', 'e', 'f'],
      kind: 'compromise',
    });
  });

  it('ranks a 2-vote place ahead of 1-vote places, keeping the tied ones', () => {
    const mutual = ['a', 'b', 'c', 'd'];
    const voters: Voter[] = [
      { memberId: 'me', picks: ['a', 'c'], required: true },
      { memberId: 'pal', picks: ['b', 'c'], required: true },
      { memberId: 'third', picks: ['b', 'd'], required: true },
    ];
    const result = resolveVotes(mutual, voters, 'me');
    expect(result.kind).toBe('compromise');
    // a and d tie for the last place, so both stay.
    expect(result.ids).toEqual(['b', 'c', 'a', 'd']);
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


describe('pre-launch: who counts in a room', () => {
  const now = Date.parse('2026-11-19T18:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  const m = (id: string, over: Partial<{ round: number; progress: number; finished: boolean; last_seen: string }> = {}) => ({
    member_id: id,
    round: 1,
    progress: 0,
    finished: false,
    last_seen: ago(5),
    ...over,
  });

  it('a member who opened the link and left without swiping does not count toward the majority', () => {
    const members = [m('me'), m('a', { progress: 12 }), m('b', { progress: 40, finished: true }), m('ghost', { last_seen: ago(600) })];
    const ids = activeMemberIds(members, 'me', 1, now, 60_000);
    expect(ids.sort()).toEqual(['a', 'b', 'me']);
    // 3 people taking part → 2 likes needed, not 3 of 4.
    expect(likesNeeded(ids.length)).toBe(2);
  });

  it('keeps someone who swiped this round even while offline, and anyone online', () => {
    const members = [m('a', { progress: 3, last_seen: ago(900) }), m('lobby'), m('old', { round: 1, progress: 0, last_seen: ago(120) })];
    expect(activeMemberIds(members, 'me', 1, now, 60_000).sort()).toEqual(['a', 'lobby', 'me']);
    // Progress from an earlier round does not count in a new round.
    expect(activeMemberIds([m('a', { round: 1, progress: 9, last_seen: ago(900) })], 'me', 2, now, 60_000)).toEqual(['me']);
  });

  it('majority over active members finds the place two of three real people liked', () => {
    const members = [m('me', { progress: 5 }), m('a', { progress: 5 }), m('b', { progress: 5 }), m('ghost', { last_seen: ago(600) })];
    const ids = activeMemberIds(members, 'me', 1, now, 60_000);
    const likes = new Map([
      ['me', new Set(['x'])],
      ['a', new Set(['x'])],
      ['b', new Set<string>()],
    ]);
    expect(candidatePlaceIds(['x', 'y'], likes, ids)).toEqual(['x']);
    // Counting the ghost would have needed 3 of 4.
    expect(candidatePlaceIds(['x', 'y'], likes, [...ids, 'ghost'])).toEqual([]);
  });
});

describe('pre-launch: re-vote never freezes on someone who left', () => {
  it('offers to continue when any voter we wait on is offline and has not voted', () => {
    expect(canDecideWithout([{ online: true, picks: ['x'] }, { online: false, picks: null }])).toBe(true);
    expect(canDecideWithout([{ online: true, picks: null }, { online: false, picks: ['x'] }])).toBe(false);
    expect(canDecideWithout([])).toBe(false);
  });

  it('group of 3: B online and voted, C offline and silent → I can finish without C', () => {
    const voters = votersForDecision({
      selfId: 'me',
      selfPicks: ['x'],
      others: [
        { memberId: 'b', online: true, picks: ['x'] },
        { memberId: 'c', online: false, picks: null },
      ],
      decideAlone: false,
    });
    expect(resolveVotes(['x', 'y', 'z', 'w'], voters, 'me').status).toBe('waiting');
    const offlineSilent = voters
      .filter((v) => v.required && v.memberId !== 'me')
      .map((v) => ({ online: v.memberId === 'b', picks: v.picks }));
    expect(canDecideWithout(offlineSilent)).toBe(true);
    const after = votersForDecision({
      selfId: 'me',
      selfPicks: ['x'],
      others: [
        { memberId: 'b', online: true, picks: ['x'] },
        { memberId: 'c', online: false, picks: null },
      ],
      decideAlone: true,
    });
    expect(resolveVotes(['x', 'y', 'z', 'w'], after, 'me')).toEqual({ status: 'ready', ids: ['x'], kind: 'agreement' });
  });
});

describe('pre-launch: re-sync after a lost write', () => {
  it('re-sends likes the server lost and a lost "finished"', () => {
    const plan = syncPlan({
      memberId: 'me',
      round: 2,
      myLikes: new Set(['a', 'b', 'c']),
      progress: 40,
      finished: true,
      likes: [
        { member_id: 'me', round: 2, place_id: 'a' },
        { member_id: 'me', round: 1, place_id: 'b' },
        { member_id: 'me', round: 102, place_id: 'c' },
        { member_id: 'friend', round: 2, place_id: 'c' },
      ],
      members: [{ member_id: 'me', round: 2, progress: 39, finished: false }],
    });
    expect(plan.missingLikes).toEqual(['b', 'c']);
    expect(plan.progressDiffers).toBe(true);
  });

  it('does nothing when the server already matches', () => {
    const plan = syncPlan({
      memberId: 'me',
      round: 1,
      myLikes: ['a'],
      progress: 3,
      finished: false,
      likes: [{ member_id: 'me', round: 1, place_id: 'a' }],
      members: [{ member_id: 'me', round: 1, progress: 3, finished: false }],
    });
    expect(plan).toEqual({ missingLikes: [], progressDiffers: false });
  });
});

describe('friend mode always converges to one winning restaurant', () => {
  it('0 matches stays empty (stage none), 1 match wins immediately', () => {
    expect(
      resolveFriendDecision({
        phase: friendPhase({ mutualIds: [], iStopped: true, friendStillSwiping: false }),
        narrowVoters: [],
        finalVoters: [],
        selfId: 'me',
        seed: 'ROOM1:1',
      }),
    ).toEqual({ stage: 'none' });

    expect(
      resolveFriendDecision({
        phase: friendPhase({ mutualIds: ['a'], iStopped: true, friendStillSwiping: false }),
        narrowVoters: [],
        finalVoters: [],
        selfId: 'me',
        seed: 'ROOM1:1',
      }),
    ).toEqual({ stage: 'winner', winnerId: 'a', kind: 'direct', tiedIds: [], finalists: ['a'] });
  });

  it('2 or 3 mutual matches go straight to a 1-pick final vote and end with one winner', () => {
    const p = friendPhase({ mutualIds: ['a', 'b', 'c'], iStopped: true, friendStillSwiping: false });
    const picking = resolveFriendDecision({
      phase: p,
      narrowVoters: [],
      finalVoters: [
        { memberId: 'me', picks: null, required: true },
        { memberId: 'pal', picks: null, required: true },
      ],
      selfId: 'me',
      seed: 'ROOM1:1',
    });
    expect(picking.stage).toBe('final_vote');
    if (picking.stage === 'final_vote') {
      expect(picking.candidates).toEqual(['a', 'b', 'c']);
      expect(picking.resolution.status).toBe('picking');
    }

    const waiting = resolveFriendDecision({
      phase: p,
      narrowVoters: [],
      finalVoters: [
        { memberId: 'me', picks: ['b'], required: true },
        { memberId: 'pal', picks: null, required: true },
      ],
      selfId: 'me',
      seed: 'ROOM1:1',
    });
    expect(waiting.stage).toBe('final_vote');
    if (waiting.stage === 'final_vote') {
      expect(waiting.resolution.status).toBe('waiting');
      expect(waiting.resolution.myPick).toBe('b');
    }

    const won = resolveFriendDecision({
      phase: p,
      narrowVoters: [],
      finalVoters: [
        { memberId: 'me', picks: ['b'], required: true },
        { memberId: 'pal', picks: ['b'], required: true },
      ],
      selfId: 'me',
      seed: 'ROOM1:1',
    });
    expect(won).toEqual({ stage: 'winner', winnerId: 'b', kind: 'vote', tiedIds: [], finalists: ['a', 'b', 'c'] });
  });

  it('4+ mutuals: unique Stage 1 winner skips Stage 2; multiple finalists advance to Stage 2 and finish with 1 winner', () => {
    const p = friendPhase({ mutualIds: ['a', 'b', 'c', 'd', 'e'], iStopped: true, friendStillSwiping: false });

    // Stage 1 unique overlap of 1 → instant winner
    const instant = resolveFriendDecision({
      phase: p,
      narrowVoters: [
        { memberId: 'me', picks: ['a', 'c', 'e'], required: true },
        { memberId: 'pal', picks: ['b', 'c', 'd'], required: true },
      ],
      finalVoters: [],
      selfId: 'me',
      seed: 'ROOM2:1',
    });
    expect(instant).toEqual({
      stage: 'winner',
      winnerId: 'c',
      kind: 'agreement',
      tiedIds: [],
      finalists: ['a', 'b', 'c', 'd', 'e'],
    });

    // Stage 1 overlap of 2 → Stage 2 final 1-pick vote over those 2
    const narrowVoters = [
      { memberId: 'me', picks: ['a', 'c', 'e'], required: true },
      { memberId: 'pal', picks: ['b', 'c', 'e'], required: true },
    ];
    const stage2 = resolveFriendDecision({
      phase: p,
      narrowVoters,
      finalVoters: [
        { memberId: 'me', picks: null, required: true },
        { memberId: 'pal', picks: null, required: true },
      ],
      selfId: 'me',
      seed: 'ROOM2:1',
    });
    expect(stage2.stage).toBe('final_vote');
    if (stage2.stage === 'final_vote') expect(stage2.candidates).toEqual(['c', 'e']);

    const finalWon = resolveFriendDecision({
      phase: p,
      narrowVoters,
      finalVoters: [
        { memberId: 'me', picks: ['e'], required: true },
        { memberId: 'pal', picks: ['e'], required: true },
      ],
      selfId: 'me',
      seed: 'ROOM2:1',
    });
    expect(finalWon).toEqual({ stage: 'winner', winnerId: 'e', kind: 'vote', tiedIds: [], finalists: ['c', 'e'] });
  });

  it('Stage 1 disjoint 3+3 tie advances all 6 to Stage 2, then Stage 2 tie-breaks only among the finalists voted for', () => {
    const mutual = ['a', 'b', 'c', 'd', 'e', 'f'];
    const p = friendPhase({ mutualIds: mutual, iStopped: true, friendStillSwiping: false });
    const narrowVoters: Voter[] = [
      { memberId: 'me', picks: ['a', 'b', 'c'], required: true },
      { memberId: 'pal', picks: ['d', 'e', 'f'], required: true },
    ];
    const stage2 = resolveFriendDecision({
      phase: p,
      narrowVoters,
      finalVoters: [
        { memberId: 'me', picks: null, required: true },
        { memberId: 'pal', picks: null, required: true },
      ],
      selfId: 'me',
      seed: 'ROOM9:1',
    });
    expect(stage2.stage).toBe('final_vote');
    if (stage2.stage === 'final_vote') expect(stage2.candidates).toEqual(mutual);

    const resolved = resolveFriendDecision({
      phase: p,
      narrowVoters,
      finalVoters: [
        { memberId: 'me', picks: ['b'], required: true },
        { memberId: 'pal', picks: ['e'], required: true },
      ],
      selfId: 'me',
      seed: 'ROOM9:1',
    });
    expect(resolved.stage).toBe('winner');
    if (resolved.stage === 'winner') {
      expect(resolved.kind).toBe('tiebreak');
      expect(resolved.tiedIds).toEqual(['b', 'e']);
      expect(['b', 'e']).toContain(resolved.winnerId);
    }
  });

  it('final vote breaks ties deterministically across all members and fairly across rooms', () => {
    const candidates = ['p1', 'p2', 'p3'];
    // p1 and p2 tie 2-2 in a 4-person room; p3 got 0 votes so p3 cannot win the tie-break.
    const votersMeFirst: Voter[] = [
      { memberId: 'me', picks: ['p1'], required: true },
      { memberId: 'b', picks: ['p1'], required: true },
      { memberId: 'c', picks: ['p2'], required: true },
      { memberId: 'd', picks: ['p2'], required: true },
    ];
    const votersReversed = [...votersMeFirst].reverse();
    const resMe = resolveFinalVote(candidates, votersMeFirst, 'me', { seed: 'ABCD2345:1' });
    const resC = resolveFinalVote(['p3', 'p2', 'p1'], votersReversed, 'c', { seed: 'ABCD2345:1' });
    expect(resMe.status).toBe('ready');
    expect(resMe.kind).toBe('tiebreak');
    expect(resMe.tiedIds).toEqual(['p1', 'p2']);
    expect(['p1', 'p2']).toContain(resMe.winnerId);
    expect(resC.winnerId).toBe(resMe.winnerId);

    // Order-independent helper
    expect(pickWinnerFromTie(['x', 'y', 'z'], 'ROOM42:1')).toBe(pickWinnerFromTie(['z', 'x', 'y'], 'ROOM42:1'));

    // Fair distribution across 100 rooms
    let aWins = 0;
    let bWins = 0;
    for (let i = 0; i < 100; i++) {
      const w = pickWinnerFromTie(['a', 'b'], `ROOM${i}:1`);
      if (w === 'a') aWins += 1;
      else if (w === 'b') bWins += 1;
    }
    expect(aWins).toBeGreaterThan(30);
    expect(bWins).toBeGreaterThan(30);
  });

  it('handles offline / departing members during the final vote', () => {
    const p = friendPhase({ mutualIds: ['a', 'b'], iStopped: true, friendStillSwiping: false });
    const waiting = votersForDecision({
      selfId: 'me',
      selfPicks: ['b'],
      others: [{ memberId: 'pal', online: false, picks: null }],
      decideAlone: false,
    });
    const r1 = resolveFriendDecision({ phase: p, narrowVoters: [], finalVoters: waiting, selfId: 'me', seed: 'R1:1' });
    expect(r1.stage).toBe('final_vote');
    if (r1.stage === 'final_vote') expect(r1.resolution.status).toBe('waiting');

    const alone = votersForDecision({
      selfId: 'me',
      selfPicks: ['b'],
      others: [{ memberId: 'pal', online: false, picks: null }],
      decideAlone: true,
    });
    expect(resolveFriendDecision({ phase: p, narrowVoters: [], finalVoters: alone, selfId: 'me', seed: 'R1:1' })).toEqual({
      stage: 'winner',
      winnerId: 'b',
      kind: 'solo',
      tiedIds: [],
      finalists: ['a', 'b'],
    });

    // If pal voted before disconnecting, their vote still counts
    const withOfflineVote = votersForDecision({
      selfId: 'me',
      selfPicks: ['b'],
      others: [
        { memberId: 'b', online: true, picks: ['a'] },
        { memberId: 'pal', online: false, picks: ['a'] },
      ],
      decideAlone: true,
    });
    expect(resolveFriendDecision({ phase: p, narrowVoters: [], finalVoters: withOfflineVote, selfId: 'me', seed: 'R1:1' })).toEqual({
      stage: 'winner',
      winnerId: 'a',
      kind: 'vote',
      tiedIds: [],
      finalists: ['a', 'b'],
    });
  });

  it('stores final 1-pick votes on ballot 2, accepted by the DB round rule, and falls back to one winner', () => {
    const accepted = (pRound: number, sessionRound: number) =>
      (pRound >= 1 && pRound <= sessionRound) || (pRound >= 100 && pRound <= 999 && pRound % 100 === sessionRound);
    for (let round = 1; round <= 50; round++) {
      expect(accepted(narrowVoteRound(round, FINAL_VOTE_BALLOT), round)).toBe(true);
    }
    const likes = [
      { member_id: 'me', round: 101, place_id: 'a' },
      { member_id: 'me', round: 201, place_id: 'c' },
      { member_id: 'me', round: 201, place_id: 'b' },
      { member_id: 'pal', round: 201, place_id: 'd' }, // ignored if not a finalist
    ];
    const map = votesFromLikes(likes, narrowVoteRound(1, FINAL_VOTE_BALLOT), ['b', 'c'], 1);
    expect(map.get('me')).toEqual(['b']);
    expect(map.has('pal')).toBe(false);

    const w1 = fallbackWinner(['a', 'b', 'c'], new Map([['a', 2], ['b', 3], ['c', 3]]), new Map([['me', ['b']]]), 'R:1');
    expect(w1).toBe('b');
    const wTie = fallbackWinner(['a', 'b'], new Map([['a', 2], ['b', 2]]), undefined, 'R:1');
    expect(wTie).toBe(fallbackWinner(['b', 'a'], new Map([['a', 2], ['b', 2]]), undefined, 'R:1'));
    expect(fallbackWinner([])).toBeNull();
  });
});
