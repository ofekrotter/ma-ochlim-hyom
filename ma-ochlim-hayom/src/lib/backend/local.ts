// Local (no-database) backend: lets the whole app — including friend mode across two tabs
// of the same browser — work in the Bolt preview before a database is connected.
import type { Settings } from '../types';
import { randomCode, type Backend, type LikeRow, type MemberRow, type SessionState } from './types';

const PREFIX = 'mo:local:session:';
const COUNTS = 'mo:local:counts';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mo-local') : null;

function read(code: string): SessionState | null {
  try {
    const s = JSON.parse(localStorage.getItem(PREFIX + code) || 'null') as SessionState | null;
    if (!s || new Date(s.session.expires_at).getTime() < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
function write(code: string, s: SessionState) {
  localStorage.setItem(PREFIX + code, JSON.stringify(s));
  channel?.postMessage({ code });
}
const now = () => new Date().toISOString();

export function createLocalBackend(): Backend {
  return {
    kind: 'local',
    async createSession(settings: Settings, deckFor) {
      let code = randomCode();
      while (read(code)) code = randomCode();
      const session = {
        code,
        settings,
        deck: deckFor(code),
        round: 1,
        created_at: now(),
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      };
      write(code, { session, members: [], likes: [] });
      return session;
    },
    async getState(code) {
      return read(code);
    },
    async join(code, memberId, isCreator) {
      const s = read(code);
      if (!s) throw new Error('not-found');
      if (s.members.some((m) => m.member_id === memberId)) return;
      if (s.members.length >= 6) throw new Error('full');
      const m: MemberRow = { code, member_id: memberId, is_creator: isCreator, round: s.session.round, progress: 0, finished: false, last_seen: now(), joined_at: now() };
      s.members.push(m);
      write(code, s);
    },
    async updateMember(code, memberId, patch) {
      const s = read(code);
      if (!s) return;
      s.members = s.members.map((m) => (m.member_id === memberId ? { ...m, ...patch, last_seen: now() } : m));
      write(code, s);
    },
    async like(code, memberId, round, placeId) {
      const s = read(code);
      if (!s) return;
      if (!s.likes.some((l) => l.member_id === memberId && l.round === round && l.place_id === placeId)) {
        const l: LikeRow = { code, member_id: memberId, round, place_id: placeId, created_at: now() };
        s.likes.push(l);
        write(code, s);
      }
    },
    async unlike(code, memberId, round, placeId) {
      const s = read(code);
      if (!s) return;
      s.likes = s.likes.filter((l) => !(l.member_id === memberId && l.round === round && l.place_id === placeId));
      write(code, s);
    },
    async advanceRound(code, expectedRound, settings, deck) {
      const s = read(code);
      if (!s || s.session.round !== expectedRound) return false;
      s.session = { ...s.session, round: expectedRound + 1, settings, deck };
      write(code, s);
      return true;
    },
    subscribe(code, onChange) {
      const onMsg = (e: MessageEvent) => e.data?.code === code && onChange();
      const onStorage = (e: StorageEvent) => e.key === PREFIX + code && onChange();
      channel?.addEventListener('message', onMsg);
      window.addEventListener('storage', onStorage);
      return () => {
        channel?.removeEventListener('message', onMsg);
        window.removeEventListener('storage', onStorage);
      };
    },
    track(event) {
      try {
        const c = JSON.parse(localStorage.getItem(COUNTS) || '{}');
        c[event] = (c[event] || 0) + 1;
        localStorage.setItem(COUNTS, JSON.stringify(c));
      } catch {
        /* ignore */
      }
    },
    async stats() {
      const totals = JSON.parse(localStorage.getItem(COUNTS) || '{}');
      return { totals, daily: [], activeSessions: 0, data: null };
    },
    async seed() {
      return { error: 'צריך לחבר מסד נתונים (Supabase) כדי להריץ את ה-seed מכאן. אפשרות חלופית: npm run seed' };
    },
  };
}
