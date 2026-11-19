// Friend sessions collect every mutual like, then narrow them to 1–3 places.
// Votes are ordinary session_likes rows on a round number that cannot collide
// with a swipe round (sessions.round is capped at 50). No new table or column.

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
  | { kind: 'empty' }
  | { kind: 'final'; ids: string[] }
  | { kind: 'narrow'; ids: string[]; reason: 'target' | 'stopped' };

export interface PhaseInput {
  /** Mutual likes in deck order. */
  mutualIds: string[];
  /** I tapped "סיימתי" or finished my cards. */
  iStopped: boolean;
  /** At least one other person is still swiping (online, and has not stopped). */
  friendStillSwiping: boolean;
  /** Any other member tapped finish or ran out of cards this round. */
  friendStopped: boolean;
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
 * Swipe until there are MUTUAL_TARGET shared likes, or either person stops.
 * 1–3 shared likes become the shortlist as-is. More than that go to a re-vote.
 * Zero shared likes never yanks the person who is still swiping.
 */
export function friendPhase(input: PhaseInput): FriendPhase {
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
