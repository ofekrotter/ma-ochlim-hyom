import { HAS_SUPABASE } from '../config';
import { createLocalBackend } from './local';
import type { Backend } from './types';

// The Supabase client is loaded lazily so it does not weigh on the landing page.
let real: Promise<Backend> | null = null;
function get(): Promise<Backend> {
  if (!real) real = HAS_SUPABASE ? import('./supabase').then((m) => m.createSupabaseBackend()) : Promise.resolve(createLocalBackend());
  return real;
}

export function preloadBackend() {
  void get();
}

export const backend: Backend = {
  kind: HAS_SUPABASE ? 'supabase' : 'local',
  createSession: (...a) => get().then((b) => b.createSession(...a)),
  getState: (...a) => get().then((b) => b.getState(...a)),
  join: (...a) => get().then((b) => b.join(...a)),
  updateMember: (...a) => get().then((b) => b.updateMember(...a)),
  like: (...a) => get().then((b) => b.like(...a)),
  unlike: (...a) => get().then((b) => b.unlike(...a)),
  advanceRound: (...a) => get().then((b) => b.advanceRound(...a)),
  subscribe(code, onChange) {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void get().then((b) => {
      if (!cancelled) unsub = b.subscribe(code, onChange);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  },
  track(event) {
    void get().then((b) => b.track(event));
  },
  stats: (...a) => get().then((b) => b.stats(...a)),
  seed: (...a) => get().then((b) => b.seed(...a)),
};

export * from './types';
