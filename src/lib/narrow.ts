// Friend sessions collect shared likes, then narrow them to 1–3 places.
// Votes are ordinary session_likes rows on a round number that cannot collide
// with a swipe round (sessions.round is capped at 50). No new table or column.
//
// Who counts as a shared like:
//   2 people — both liked it (the original pair rule).
//   3–6 people — a strict majority of whoever is in the room right now
//   (3 → 2, 4 → 3, 5 → 3, 6 → 4). One person cannot block the group, and a tie
//   is not enough. The room already stops at 6 members (the database rule).

/** Stop swiping once this many places are liked by both sides, and narrow. */
export const MUTUAL_TARGET = 5;
/** A finished shortlist is never longer than this. */
export const SHORTLIST_MAX = 3;
/** Each person may keep at most this many places in the re-vote. */
export const PICK_CAP = 3;
/**
 * A hidden tab stops heartbeats, so "offline" for a minute is normal.
 * Only offer to finish without them after this long with no sign of life.
 */
export const VOTE_AWAY_MS = 3 * 60 * 1000;

export type FriendPhase =
  | { kind: 'swipe' }
  | { kind: 'waiting' }
  | { kind: 'holding'; ids: string[] }
  | { kind: 'empty' }
  | { kind: 'final'; ids: string[] }
  | { kind: 'narrow'; ids: string[]; reason: 'target' | 'stopped' };

export interface PhaseInput {
  /** Shared likes in deck order. For a pair that means both liked it. */
  mutualIds: string[];
  /** I tapped "סיימתי" or finished my cards. */
  iStopped: boolean;
  /** At least one other person is still swiping (online, and has not stopped). */
  friendStillSwiping: boolean;
  /** Any other member tapped finish or ran out of cards this round. */
  friendStopped: boolean;
  /** People in the room. Omitted or 2 keeps the pair stop rule. */
  memberCount?: number;
  /** How many members, including me, have stopped. Groups use this. */
  stoppedCount?: number;
}

export type VoteStatus = 'picking' | 'waiting' | 'ready';
export type ShortlistKind = 'agreement' | 'compromise' | 'solo';

export interface Voter {
  memberId: string;
  /** null = has not submitted. */
  picks: string[] | null;
  /** Offline members stay required until someone explicitly continues alone. */
  required: boolean;
}

export interface VoteResolution {
  status: VoteStatus;
  ids: string[];
  kind: ShortlistKind | null;
}

/** True only after a long silence. An unreadable timestamp is not "away" — we keep waiting. */
export function memberIsAway(lastSeenIso: string, now: number, awayMs = VOTE_AWAY_MS): boolean {
  const t = Date.parse(lastSeenIso);
  if (Number.isNaN(t)) return false;
  return now - t > awayMs;
}

/** Swipe likes use session.round (1–50). Narrowing votes use 100, 200, … + that round. */
export function narrowVoteRound(sessionRound: number, ballot = 1): number {
  const b = Math.max(1, Math.floor(ballot));
  const r = Math.max(0, Math.floor(sessionRound));
  return b * 100 + r;
}

export function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Likes needed before a place is a candidate.
 * A room of one still waits for a second person. Pairs need both.
 * Groups of 3+ need a strict majority of the people currently in the room.
 */
export function likesNeeded(memberCount: number): number {
  const n = Math.max(2, Math.floor(memberCount) || 2);
  if (n <= 2) return 2;
  return Math.floor(n / 2) + 1;
}

/** Deck order. A place is included once `likesNeeded(members)` distinct members liked it. */
export function candidatePlaceIds(
  deckIds: readonly string[],
  likesByMember: ReadonlyMap<string, ReadonlySet<string>>,
  memberIds: readonly string[],
): string[] {
  const members = uniqueIds([...memberIds]);
  const need = likesNeeded(members.length);
  const out: string[] = [];
  for (const id of uniqueIds([...deckIds])) {
    let n = 0;
    for (const memberId of members) {
      if (likesByMember.get(memberId)?.has(id)) n += 1;
    }
    if (n >= need) out.push(id);
  }
  return out;
}

function pairPhase(input: PhaseInput): FriendPhase {
  const ids = uniqueIds(input.mutualIds);
  const n = ids.length;
  const target = n >= MUTUAL_TARGET;
  const someoneStopped = input.iStopped || input.friendStopped;

  if (!target && !someoneStopped) return { kind: 'swipe' };

  if (n === 0) {
    if (!input.iStopped) return { kind: 'swipe' };
    return input.friendStillSwiping ? { kind: 'waiting' } : { kind: 'empty' };
  }

  if (n <= SHORTLIST_MAX) return { kind: 'final', ids };
  return { kind: 'narrow', ids, reason: target ? 'target' : 'stopped' };
}

/**
 * Swipe until there are MUTUAL_TARGET shared likes, or the room's stop rule fires.
 * Pairs: either person stopping is enough. Groups of 3+: a strict majority must
 * have stopped (or nobody is left swiping) so one early "סיימתי" does not end
 * the room. 1–3 shared likes become the shortlist. More than that go to a re-vote.
 * Zero shared likes never yanks someone who is still swiping.
 */
export function friendPhase(input: PhaseInput): FriendPhase {
  const members = input.memberCount ?? 2;
  if (members <= 2) return pairPhase(input);

  const ids = uniqueIds(input.mutualIds);
  const n = ids.length;
  const stopped = input.stoppedCount ?? (input.iStopped ? 1 : 0) + (input.friendStopped ? 1 : 0);
  const majorityStopped = stopped >= likesNeeded(members);
  const target = n >= MUTUAL_TARGET;
  const nobodyLeft = input.iStopped && !input.friendStillSwiping;
  const locked = target || majorityStopped || nobodyLeft;

  if (!locked) {
    if (!input.iStopped) return { kind: 'swipe' };
    if (n === 0) return input.friendStillSwiping ? { kind: 'waiting' } : { kind: 'empty' };
    return { kind: 'holding', ids };
  }

  if (n === 0) {
    if (!input.iStopped) return { kind: 'swipe' };
    return input.friendStillSwiping ? { kind: 'waiting' } : { kind: 'empty' };
  }
  if (n <= SHORTLIST_MAX) return { kind: 'final', ids };
  return { kind: 'narrow', ids, reason: target ? 'target' : 'stopped' };
}

/** Keep only real mutuals, in deck order, capped at PICK_CAP. */
export function sanitizePicks(mutualIds: string[], picks: string[]): string[] {
  const order = new Map(uniqueIds(mutualIds).map((id, i) => [id, i]));
  return [...new Set(picks)]
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!)
    .slice(0, PICK_CAP);
}

export function votesFromLikes(
  likes: { member_id: string; round: number; place_id: string }[],
  voteRound: number,
  mutualIds: string[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const like of likes) {
    if (like.round !== voteRound) continue;
    const list = grouped.get(like.member_id) ?? [];
    list.push(like.place_id);
    grouped.set(like.member_id, list);
  }
  const out = new Map<string, string[]>();
  for (const [memberId, picks] of grouped) {
    const clean = sanitizePicks(mutualIds, picks);
    if (clean.length) out.set(memberId, clean);
  }
  return out;
}

export function votersForDecision(args: {
  selfId: string;
  selfPicks: string[] | null;
  others: { memberId: string; online: boolean; picks: string[] | null }[];
  /** Drop offline members who never voted, and do not wait for them. */
  decideAlone: boolean;
}): Voter[] {
  const voters: Voter[] = [{ memberId: args.selfId, picks: args.selfPicks, required: true }];
  for (const other of args.others) {
    if (other.memberId === args.selfId) continue;
    if (other.online) {
      voters.push({ memberId: other.memberId, picks: other.picks, required: true });
    } else if (other.picks) {
      voters.push({ memberId: other.memberId, picks: other.picks, required: false });
    } else if (!args.decideAlone) {
      voters.push({ memberId: other.memberId, picks: null, required: true });
    }
  }
  return voters;
}

/**
 * Overlap of 1–3 wins. No overlap → up to 3 places with the most votes
 * (deck order breaks ties). One voter left in the room → their picks.
 */
export function resolveVotes(mutualIds: string[], voters: Voter[], selfId: string): VoteResolution {
  const order = new Map(uniqueIds(mutualIds).map((id, i) => [id, i]));
  const mutual = [...order.keys()];
  const norm = (picks: string[] | null): string[] | null => {
    if (!picks) return null;
    const clean = sanitizePicks(mutual, picks);
    return clean.length ? clean : null;
  };

  const selfPicks = norm(voters.find((v) => v.memberId === selfId)?.picks ?? null);
  if (!selfPicks) return { status: 'picking', ids: [], kind: null };

  const waitingOn = voters.some((v) => v.required && v.memberId !== selfId && !norm(v.picks));
  if (waitingOn) return { status: 'waiting', ids: selfPicks, kind: null };

  const ballots = voters.map((v) => norm(v.picks)).filter((p): p is string[] => Boolean(p));
  if (ballots.length <= 1) return { status: 'ready', ids: selfPicks, kind: 'solo' };

  const counts = new Map<string, number>(mutual.map((id) => [id, 0]));
  for (const ballot of ballots) {
    for (const id of ballot) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const intersection = mutual.filter((id) => ballots.every((b) => b.includes(id)));
  if (intersection.length > 0) {
    return { status: 'ready', ids: intersection.slice(0, SHORTLIST_MAX), kind: 'agreement' };
  }

  const ranked = mutual
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || order.get(a)! - order.get(b)!);
  return { status: 'ready', ids: ranked.slice(0, SHORTLIST_MAX), kind: 'compromise' };
}

/** Used when the vote rows cannot be saved: first 1–3 mutuals, in deck order. */
export function fallbackShortlist(mutualIds: string[]): string[] {
  return uniqueIds(mutualIds).slice(0, SHORTLIST_MAX);
}
