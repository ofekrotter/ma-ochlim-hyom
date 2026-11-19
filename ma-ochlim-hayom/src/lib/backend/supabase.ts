import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import type { Settings } from '../types';
import { randomCode, SessionError, type Backend, type SeedResult, type SessionRow, type StatsResult } from './types';

export function createSupabaseBackend(): Backend {
  const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  async function callFn<T>(name: string, body: unknown): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({ error: `שגיאת שרת (${res.status})` }));
    if (!res.ok) throw new Error(j.error || `שגיאת שרת (${res.status})`);
    return j as T;
  }

  return {
    kind: 'supabase',

    async createSession(settings: Settings, deckFor) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = randomCode();
        const deck = deckFor(code);
        const { data, error } = await sb.from('sessions').insert({ code, settings, deck }).select().single();
        if (!error && data) return data as SessionRow;
        if (error && error.code !== '23505') throw new SessionError(error.message);
      }
      throw new SessionError('לא הצלחנו ליצור קוד, נסו שוב');
    },

    async getState(code) {
      const [s, m, l] = await Promise.all([
        sb.from('sessions').select('*').eq('code', code).maybeSingle(),
        sb.from('session_members').select('*').eq('code', code),
        sb.from('session_likes').select('*').eq('code', code),
      ]);
      if (s.error) throw new SessionError(s.error.message);
      if (!s.data) return null;
      return { session: s.data as SessionRow, members: m.data ?? [], likes: l.data ?? [] };
    },

    async join(code, memberId, isCreator) {
      const { data } = await sb.from('session_members').select('member_id').eq('code', code).eq('member_id', memberId).maybeSingle();
      if (data) return;
      const { error } = await sb.from('session_members').insert({ code, member_id: memberId, is_creator: isCreator });
      if (error && error.code !== '23505') throw new SessionError(error.message.includes('row-level') ? 'full' : error.message);
    },

    async updateMember(code, memberId, patch) {
      const { error } = await sb
        .from('session_members')
        .update({ ...patch, last_seen: new Date().toISOString() })
        .eq('code', code)
        .eq('member_id', memberId);
      if (error) throw new SessionError(error.message);
    },

    async like(code, memberId, round, placeId) {
      const { error } = await sb
        .from('session_likes')
        .upsert({ code, member_id: memberId, round, place_id: placeId }, { onConflict: 'code,member_id,round,place_id', ignoreDuplicates: true });
      if (error) throw new SessionError(error.message);
    },

    async unlike(code, memberId, round, placeId) {
      await sb.from('session_likes').delete().match({ code, member_id: memberId, round, place_id: placeId });
    },

    async advanceRound(code, expectedRound, settings, deck) {
      const { data, error } = await sb
        .from('sessions')
        .update({ round: expectedRound + 1, settings, deck })
        .eq('code', code)
        .eq('round', expectedRound)
        .select('code');
      if (error) throw new SessionError(error.message);
      return (data?.length ?? 0) > 0;
    },

    subscribe(code, onChange) {
      const channel = sb
        .channel(`session-${code}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'session_members', filter: `code=eq.${code}` }, onChange)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_likes', filter: `code=eq.${code}` }, onChange)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onChange(); // catch up after (re)connect
        });
      return () => {
        void sb.removeChannel(channel);
      };
    },

    track(event) {
      void sb.rpc('track_event', { p_event: event }).then(
        () => undefined,
        () => undefined,
      );
    },

    stats: (password) => callFn<StatsResult>('stats', { password }),
    seed: (password) => callFn<SeedResult>('seed', { password }),
  };
}
