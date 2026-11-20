// Friend sessions collect shared likes, then narrow them to 1–3 places.
// Votes are ordinary session_likes rows on a round number that cannot collide
// with a swipe round (sessions.round is capped at 50). No new table or column.
//
// Who counts as a shared like:
//   2 people — both liked it (the original pair rule).
//   3–6 people — a strict majority of whoever is in the room right now
//   (3 → 2, 4 → 3, 5 → 3, 6 → 4). One person cannot block the group, and a tie
//   is not enough. The room already stops at 6 members (the database rule).

/**
 * Enough shared likes to suggest tapping "סיימתי". Only a hint in the UI:
 * reaching it never ends anyone's swiping on its own.
 */
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
  | { kind: 'narrow'; ids: string[] };

export interface PhaseInput {
  /** Shared likes in deck order. For a pair that means both liked it. */
  mutualIds: string[];
  /** I tapped "סיימתי" or finished my cards. */
  iStopped: boolean;
  /** At least one other person is still swiping (not away, and has not stopped). */
  friendStillSwiping: boolean;
  /** Any other member tapped finish or ran out of cards this round. Informational. */
  friendStopped?: boolean;
  /** People in the room. Informational; the stop rule is the same for any size. */
  memberCount?: number;
  /** How many members, including me, have stopped. Informational. */
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

/**
 * Nobody is ever pulled off their own deck. The room locks (shortlist or
 * re-vote) only after I stopped AND nobody else is still swiping — every other
 * member finished their cards, tapped "סיימתי", or has been away long enough
 * that the caller no longer counts them as swiping.
 *
 * - Still swiping myself → swipe. Always, whatever the others did.
 * - I stopped, someone is still swiping → 'waiting' (nothing shared yet) or
 *   'holding' (show what we have so far, and let me resume).
 * - Everyone is done → 0 shared: 'empty'; 1–3: 'final'; more: 'narrow' (re-vote).
 */
export function friendPhase(input: PhaseInput): FriendPhase {
  const ids = uniqueIds(input.mutualIds);
  const n = ids.length;

  if (!input.iStopped) return { kind: 'swipe' };

  if (input.friendStillSwiping) {
    return n === 0 ? { kind: 'waiting' } : { kind: 'holding', ids };
  }

  if (n === 0) return { kind: 'empty' };
  if (n <= SHORTLIST_MAX) return { kind: 'final', ids };
  return { kind: 'narrow', ids };
}

/** Keep only real mutuals, in deck order, capped at `cap` (default PICK_CAP). */
export function sanitizePicks(mutualIds: string[], picks: string[], cap = PICK_CAP): string[] {
  const order = new Map(uniqueIds(mutualIds).map((id, i) => [id, i]));
  return [...new Set(picks)]
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!)
    .slice(0, Math.max(1, Math.floor(cap)));
}

export function votesFromLikes(
  likes: { member_id: string; round: number; place_id: string }[],
  voteRound: number,
  mutualIds: string[],
  cap = PICK_CAP,
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
    const clean = sanitizePicks(mutualIds, picks, cap);
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
 * Overlap of 1–3 wins. No overlap → the places with the most votes: up to 3,
 * plus any place tied with the third (see cutWithTies). One voter left in the
 * room → their picks.
 */
export function resolveVotes(
  mutualIds: string[],
  voters: Voter[],
  selfId: string,
  opts: { likeCounts?: ReadonlyMap<string, number>; seed?: string } = {},
): VoteResolution {
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
  return { status: 'ready', ids: cutWithTies(ranked, counts, opts), kind: 'compromise' };
}

/**
 * A shortlist can grow past SHORTLIST_MAX only to keep places that tied at the
 * cut, and never past this. Two people with 3 different picks each is 6.
 */
export const TIE_KEEP_MAX = 6;

/** Deterministic, order-free number for an id (FNV-1a). Same on every phone. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The top SHORTLIST_MAX by votes, but fair at the cut: every place tied with
 * the last one kept stays too (nobody's picks win just because of deck order or
 * who voted first). If that would pass TIE_KEEP_MAX (a big group where nearly
 * every pick differs), keeping them all would not narrow anything, so the tied
 * places are ordered by how many people liked them while swiping, then by a
 * hash of the room seed and place id (the same on every phone, unrelated to who
 * voted first or deck position), and the list is cut back to SHORTLIST_MAX.
 */
export function cutWithTies(
  ranked: string[],
  votes: ReadonlyMap<string, number>,
  opts: { likeCounts?: ReadonlyMap<string, number>; seed?: string } = {},
): string[] {
  if (ranked.length <= SHORTLIST_MAX) return ranked;
  const cutVotes = votes.get(ranked[SHORTLIST_MAX - 1]) ?? 0;
  const above = ranked.filter((id) => (votes.get(id) ?? 0) > cutVotes);
  const tied = ranked.filter((id) => (votes.get(id) ?? 0) === cutVotes);
  if (above.length + tied.length <= TIE_KEEP_MAX) return [...above, ...tied];
  const seed = opts.seed ?? '';
  const fair = [...tied].sort(
    (a, b) =>
      (opts.likeCounts?.get(b) ?? 0) - (opts.likeCounts?.get(a) ?? 0) ||
      stableHash(`${seed}:${a}`) - stableHash(`${seed}:${b}`) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return [...above, ...fair].slice(0, SHORTLIST_MAX);
}

/**
 * Used when the vote rows cannot be saved: the 1–3 shared places the most
 * people liked (and voted for, when any votes did land), deck order breaking ties.
 */
export function fallbackShortlist(
  mutualIds: string[],
  likeCounts?: ReadonlyMap<string, number>,
  votes?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const mutual = uniqueIds(mutualIds);
  const order = new Map(mutual.map((id, i) => [id, i]));
  const voteCount = new Map<string, number>();
  for (const ballot of votes?.values() ?? []) {
    for (const id of new Set(ballot)) voteCount.set(id, (voteCount.get(id) ?? 0) + 1);
  }
  return [...mutual]
    .sort(
      (a, b) =>
        (voteCount.get(b) ?? 0) - (voteCount.get(a) ?? 0) ||
        (likeCounts?.get(b) ?? 0) - (likeCounts?.get(a) ?? 0) ||
        order.get(a)! - order.get(b)!,
    )
    .slice(0, SHORTLIST_MAX);
}

/**
 * Who counts toward the majority (and must be waited for) this round: me, plus
 * anyone who has swiped or finished this round, plus anyone online right now.
 * Someone who opened the link and left without swiping (a second browser on the
 * same phone, a curious tap) no longer raises the bar for everyone else.
 */
export function activeMemberIds(
  members: readonly { member_id: string; round: number; progress: number; finished: boolean; last_seen: string }[],
  selfId: string,
  round: number,
  now: number,
  onlineMs: number,
): string[] {
  const out = [selfId];
  for (const m of members) {
    if (m.member_id === selfId) continue;
    const swiped = m.round === round && (m.progress > 0 || m.finished);
    const t = Date.parse(m.last_seen);
    const online = Number.isFinite(t) && now - t < onlineMs;
    if (swiped || online) out.push(m.member_id);
  }
  return uniqueIds(out);
}

/**
 * Offer "continue without them" in the re-vote as soon as anyone we are waiting
 * on is offline and has not voted — not only when the most recently seen friend is away.
 */
export function canDecideWithout(others: readonly { online: boolean; picks: string[] | null }[]): boolean {
  return others.some((o) => !o.online && !(o.picks && o.picks.length > 0));
}

/**
 * What this browser must re-send after a failed write or coming back online:
 * own likes for this round that the server does not have, and whether the
 * server's copy of my progress differs from mine.
 */
export function syncPlan(args: {
  memberId: string;
  round: number;
  myLikes: Iterable<string>;
  progress: number;
  finished: boolean;
  likes: readonly { member_id: string; round: number; place_id: string }[];
  members: readonly { member_id: string; round: number; progress: number; finished: boolean }[];
}): { missingLikes: string[]; progressDiffers: boolean } {
  const onServer = new Set(args.likes.filter((l) => l.member_id === args.memberId && l.round === args.round).map((l) => l.place_id));
  const missingLikes = uniqueIds([...args.myLikes].filter((id) => !onServer.has(id)));
  const me = args.members.find((m) => m.member_id === args.memberId);
  const progressDiffers = !me || me.round !== args.round || me.progress !== args.progress || me.finished !== args.finished;
  return { missingLikes, progressDiffers };
}

export type RoundNotice = 'restart' | 'widen';

/** What changed when the round number went up: a wider radius, or a reshuffle. */
export function roundChangeNotice(prev: { round: number; radius: number }, next: { round: number; radius: number }): RoundNotice {
  return next.radius > prev.radius ? 'widen' : 'restart';
}

export const FINAL_VOTE_BALLOT = 2;

export type FinalOutcomeKind = 'direct' | 'agreement' | 'compromise' | 'vote' | 'tiebreak' | 'solo' | 'fallback';

export interface FinalVoteResolution {
  status: VoteStatus;
  candidates: string[];
  myPick: string | null;
  winnerId: string | null;
  tiedIds: string[];
  kind: 'vote' | 'tiebreak' | 'solo' | null;
}

export type FriendDecision =
  | { stage: 'none' }
  | { stage: 'narrow'; candidates: string[]; resolution: VoteResolution }
  | { stage: 'final_vote'; candidates: string[]; resolution: FinalVoteResolution }
  | { stage: 'winner'; winnerId: string; kind: FinalOutcomeKind; tiedIds: string[]; finalists: string[] };

/**
 * Deterministic, fair tie-breaker seeded by the room and round.
 * Independent of candidate order, deck order, or who voted first.
 */
export function pickWinnerFromTie(ids: readonly string[], seed: string): string | null {
  const unique = uniqueIds([...ids]);
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  const sorted = [...unique].sort(
    (a, b) =>
      stableHash(`${seed}:final:${a}`) - stableHash(`${seed}:final:${b}`) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return sorted[0];
}

/**
 * Final 1-pick vote among 2+ finalists. Once all required voters have chosen
 * their 1 favorite, the top vote-getter wins; any tie for first place is broken
 * deterministically using the room seed so every member sees the exact same winner.
 */
export function resolveFinalVote(
  candidates: readonly string[],
  voters: readonly Voter[],
  selfId: string,
  opts: { seed?: string } = {},
): FinalVoteResolution {
  const list = uniqueIds([...candidates]);
  if (list.length === 0) {
    return { status: 'ready', candidates: [], myPick: null, winnerId: null, tiedIds: [], kind: null };
  }
  const order = new Map(list.map((id, i) => [id, i]));
  const normOne = (picks: string[] | null): string | null => {
    if (!picks) return null;
    const clean = sanitizePicks(list, picks, 1);
    return clean[0] ?? null;
  };

  const myPick = normOne(voters.find((v) => v.memberId === selfId)?.picks ?? null);
  if (!myPick) {
    return { status: 'picking', candidates: list, myPick: null, winnerId: null, tiedIds: [], kind: null };
  }

  const waitingOn = voters.some((v) => v.required && v.memberId !== selfId && !normOne(v.picks));
  if (waitingOn) {
    return { status: 'waiting', candidates: list, myPick, winnerId: null, tiedIds: [], kind: null };
  }

  const ballots = voters.map((v) => normOne(v.picks)).filter((p): p is string => Boolean(p));
  if (ballots.length <= 1) {
    return { status: 'ready', candidates: list, myPick, winnerId: myPick, tiedIds: [], kind: 'solo' };
  }

  const counts = new Map<string, number>(list.map((id) => [id, 0]));
  for (const id of ballots) counts.set(id, (counts.get(id) ?? 0) + 1);

  const maxVotes = Math.max(...counts.values());
  const top = list
    .filter((id) => (counts.get(id) ?? 0) === maxVotes)
    .sort((a, b) => order.get(a)! - order.get(b)!);

  if (top.length === 1) {
    return { status: 'ready', candidates: list, myPick, winnerId: top[0], tiedIds: [], kind: 'vote' };
  }

  const winnerId = pickWinnerFromTie(top, opts.seed ?? '');
  return { status: 'ready', candidates: list, myPick, winnerId, tiedIds: top, kind: 'tiebreak' };
}

/**
 * Drives a finished friend room all the way to ONE single winning restaurant:
 * - 1 mutual match → immediate winner
 * - 2–3 mutual matches → final 1-pick vote (with deterministic tie-break if tied)
 * - 4+ mutual matches → Stage 1 narrow (up to 3 picks); if 1 survives → winner;
 *   if 2+ finalists remain → Stage 2 final 1-pick vote (with tie-break if tied).
 */
export function resolveFriendDecision(args: {
  phase: FriendPhase;
  narrowVoters: readonly Voter[];
  finalVoters: readonly Voter[];
  selfId: string;
  likeCounts?: ReadonlyMap<string, number>;
  seed?: string;
  fallbackWinnerId?: string | null;
}): FriendDecision {
  const { phase, narrowVoters, finalVoters, selfId, likeCounts, seed = '', fallbackWinnerId } = args;
  if (phase.kind !== 'final' && phase.kind !== 'narrow') {
    return { stage: 'none' };
  }

  if (fallbackWinnerId && phase.ids.includes(fallbackWinnerId)) {
    return { stage: 'winner', winnerId: fallbackWinnerId, kind: 'fallback', tiedIds: [], finalists: phase.ids };
  }

  if (phase.kind === 'final') {
    if (phase.ids.length === 0) return { stage: 'none' };
    if (phase.ids.length === 1) {
      return { stage: 'winner', winnerId: phase.ids[0], kind: 'direct', tiedIds: [], finalists: phase.ids };
    }
    const finalRes = resolveFinalVote(phase.ids, finalVoters, selfId, { seed });
    if (finalRes.status === 'ready' && finalRes.winnerId) {
      return {
        stage: 'winner',
        winnerId: finalRes.winnerId,
        kind: finalRes.kind ?? 'vote',
        tiedIds: finalRes.tiedIds,
        finalists: phase.ids,
      };
    }
    return { stage: 'final_vote', candidates: phase.ids, resolution: finalRes };
  }

  const res1 = resolveVotes(phase.ids, [...narrowVoters], selfId, { likeCounts, seed });
  if (res1.status !== 'ready') {
    return { stage: 'narrow', candidates: phase.ids, resolution: res1 };
  }
  if (res1.ids.length === 1) {
    return {
      stage: 'winner',
      winnerId: res1.ids[0],
      kind: res1.kind ?? 'agreement',
      tiedIds: [],
      finalists: phase.ids,
    };
  }
  if (res1.ids.length === 0) {
    return { stage: 'narrow', candidates: phase.ids, resolution: res1 };
  }

  const finalRes = resolveFinalVote(res1.ids, finalVoters, selfId, { seed });
  if (finalRes.status === 'ready' && finalRes.winnerId) {
    return {
      stage: 'winner',
      winnerId: finalRes.winnerId,
      kind: finalRes.kind ?? 'vote',
      tiedIds: finalRes.tiedIds,
      finalists: res1.ids,
    };
  }
  return { stage: 'final_vote', candidates: res1.ids, resolution: finalRes };
}

/**
 * Used when vote rows cannot be saved: picks the single highest-supported
 * candidate (votes that landed, then swipe likes, then deterministic room hash).
 */
export function fallbackWinner(
  candidates: string[],
  likeCounts?: ReadonlyMap<string, number>,
  votes?: ReadonlyMap<string, readonly string[]>,
  seed = '',
): string | null {
  const list = uniqueIds(candidates);
  if (list.length === 0) return null;
  const voteCount = new Map<string, number>();
  for (const ballot of votes?.values() ?? []) {
    for (const id of new Set(ballot)) voteCount.set(id, (voteCount.get(id) ?? 0) + 1);
  }
  const ranked = [...list].sort(
    (a, b) =>
      (voteCount.get(b) ?? 0) - (voteCount.get(a) ?? 0) ||
      (likeCounts?.get(b) ?? 0) - (likeCounts?.get(a) ?? 0) ||
      stableHash(`${seed}:fallback:${a}`) - stableHash(`${seed}:fallback:${b}`) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return ranked[0] ?? null;
}
