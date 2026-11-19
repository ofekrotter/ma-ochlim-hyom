import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { roomSettings } from '../geo';
import type { Settings } from '../types';
import { randomCode, SessionError, type Backend, type SeedResult, type SessionRow, type StatsResult } from './types';

const memoryTokens = new Map<string, string>();

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Secret that proves this browser is the member it claims to be. The database stores only a hash. */
function roomToken(code: string): string {
  const key = `mo:room:${code}`;
  try {
    let token = localStorage.getItem(key);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      token = newToken();
      localStorage.setItem(key, token);
    }
    return token;
  } catch {
    let token = memoryTokens.get(code);
    if (!token) {
      token = newToken();
      memoryTokens.set(code, token);
    }
    return token;
  }
}

function fail(error: { message?: string; code?: string } | null): SessionError {
  const msg = error?.message || '';
  if (msg.includes('full')) return new SessionError('full');
  if (msg.includes('forbidden')) return new SessionError('forbidden');
  if (msg.includes('not-found')) return new SessionError('not-found');
  if (msg.includes('busy')) return new SessionError('busy');
  return new SessionError('שגיאה זמנית, נסו שוב');
}

export function createSupabaseBackend(): Backend {
  const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 2 } },
  });

  async function callFn<T>(name: string, body: unknown): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({ error: `שגיאת שרת (${res.status})` }));
    if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : `שגיאת שרת (${res.status})`);
    return j as T;
  }

  return {
    kind: 'supabase',

    async createSession(settings: Settings, deckFor) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = randomCode();
        const deck = deckFor(code);
        const { data, error } = await sb.rpc('create_friend_session', { p_code: code, p_settings: roomSettings(settings), p_deck: deck });
        if (!error && data) return data as SessionRow;
        if (error?.code === '23505' || (error?.message || '').includes('duplicate')) continue;
        throw fail(error);
      }
      throw new SessionError('לא הצלחנו ליצור קוד, נסו שוב');
    },

    async getState(code) {
      const { data, error } = await sb.rpc('get_friend_state', { p_code: code });
      if (error) throw fail(error);
      if (!data) return null;
      return data as Awaited<ReturnType<Backend['getState']>>;
    },

    async join(code, memberId, isCreator) {
      const { error } = await sb.rpc('join_friend_session', {
        p_code: code,
        p_member_id: memberId,
        p_is_creator: isCreator,
        p_token: roomToken(code),
      });
      if (error) throw fail(error);
    },

    async updateMember(code, memberId, patch) {
      const { error } = await sb.rpc('update_friend_member', {
        p_code: code,
        p_member_id: memberId,
        p_token: roomToken(code),
        p_round: patch.round ?? null,
        p_progress: patch.progress ?? null,
        p_finished: patch.finished ?? null,
      });
      if (error) throw fail(error);
    },

    async like(code, memberId, round, placeId) {
      const { error } = await sb.rpc('like_friend_place', {
        p_code: code,
        p_member_id: memberId,
        p_token: roomToken(code),
        p_round: round,
        p_place_id: placeId,
      });
      if (error) throw fail(error);
    },

    async unlike(code, memberId, round, placeId) {
      const { error } = await sb.rpc('unlike_friend_place', {
        p_code: code,
        p_member_id: memberId,
        p_token: roomToken(code),
        p_round: round,
        p_place_id: placeId,
      });
      if (error) throw fail(error);
    },

    async advanceRound(code, expectedRound, settings, deck) {
      const memberKey = `mo:member:${code}`;
      let memberId = '';
      try {
        memberId = localStorage.getItem(memberKey) || '';
      } catch {
        memberId = '';
      }
      if (!memberId) throw new SessionError('forbidden');
      const { data, error } = await sb.rpc('advance_friend_round', {
        p_code: code,
        p_member_id: memberId,
        p_token: roomToken(code),
        p_expected_round: expectedRound,
        p_settings: settings,
        p_deck: deck,
      });
      if (error) throw fail(error);
      return data === true;
    },

    subscribe(code, onChange) {
      const channel = sb
        .channel(`room:${code}`)
        .on('broadcast', { event: 'tick' }, () => onChange())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onChange();
        });
      return () => {
        void sb.removeChannel(channel);
      };
    },

    track(event) {
      if (!/^[a-z0-9_]{1,40}$/.test(event)) return;
      void sb.rpc('track_event', { p_event: event }).then(
        () => undefined,
        () => undefined,
      );
    },

    stats: (password) => callFn<StatsResult>('stats', { password }),
    seed: (password) => callFn<SeedResult>('seed', { password }),
  };
}
