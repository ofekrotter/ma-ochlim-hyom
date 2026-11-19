import { useCallback, useState } from 'react';
import type { Dir } from '../components/SwipeDeck';

export interface SoloRun {
  seed: string;
  index: number;
  likes: string[];
  history: { id: string; dir: Dir }[];
  finished: boolean;
  /** When this round's deck was frozen, so open/closed doesn't reshuffle mid-swipe. */
  at?: string;
}
const KEY = 'mo:solo';

function fresh(): SoloRun {
  return { seed: Math.random().toString(36).slice(2, 10), index: 0, likes: [], history: [], finished: false, at: new Date().toISOString() };
}
export function newSoloRun() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(fresh()));
  } catch {
    /* ignore */
  }
}
function load(): SoloRun {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null') ?? fresh();
  } catch {
    return fresh();
  }
}

export function useSoloRun() {
  const [run, setRunState] = useState<SoloRun>(load);
  const setRun = useCallback((fn: (r: SoloRun) => SoloRun) => {
    setRunState((prev) => {
      const next = fn(prev);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [run, setRun] as const;
}
