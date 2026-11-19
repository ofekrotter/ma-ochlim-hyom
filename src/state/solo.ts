import { useCallback, useState } from 'react';
import type { Dir } from '../components/SwipeDeck';
import type { Settings } from '../lib/types';

export interface SoloRun {
  seed: string;
  index: number;
  likes: string[];
  history: { id: string; dir: Dir }[];
  finished: boolean;
  /** When this round's deck was frozen, so open/closed doesn't reshuffle mid-swipe. */
  at?: string;
  /** Filters this deck was built with (see settingsKey). A change asks before restarting. */
  key?: string;
  /** The same filters, so the deck stays the same even if the filter screens are changed and left. */
  filters?: SoloFilters;
  /** Head-to-head on /result, kept so a refresh does not start it over. */
  duel?: SoloDuel;
}

export interface SoloDuel {
  /** The liked places in the order they are compared, frozen when the duel starts. */
  ids: string[];
  champ: number;
  next: number;
}

export type SoloFilters = Pick<Settings, 'location' | 'radius' | 'prices' | 'cuisines' | 'minRating' | 'sort'>;

export function soloFilters(s: SoloFilters): SoloFilters {
  return { location: s.location, radius: s.radius, prices: [...s.prices], cuisines: [...s.cuisines], minRating: s.minRating ?? null, sort: s.sort };
}

/** The filters that decide which cards a solo deck has. */
export function settingsKey(s: SoloFilters): string {
  return JSON.stringify([
    s.location ? [Math.round(s.location.lat * 1e4), Math.round(s.location.lng * 1e4)] : null,
    s.radius,
    [...s.prices].sort(),
    [...s.cuisines].sort(),
    s.minRating ?? null,
    s.sort ?? 'mixed',
  ]);
}

/** A solo deck someone has started and not finished. */
export function soloInProgress(run: Pick<SoloRun, 'index' | 'finished'> | null): boolean {
  return Boolean(run && run.index > 0 && !run.finished);
}

/**
 * Places the duel runs over. A saved duel keeps its own list (so a place that
 * closed meanwhile does not reshuffle it) unless a like was added or removed
 * since, or one of its places is gone from the data; then it starts over on the
 * places open now.
 */
export function duelPool(savedIds: string[] | undefined, likes: string[], known: string[], openNow: string[]): string[] {
  if (savedIds && savedIds.length > 0) {
    const likeSet = new Set(likes);
    const knownSet = new Set(known);
    const saved = new Set(savedIds);
    const intact = savedIds.every((id) => likeSet.has(id) && knownSet.has(id)) && openNow.every((id) => saved.has(id));
    if (intact) return savedIds;
  }
  return openNow;
}

/**
 * The duel's state after a reload: the saved one when it still matches the
 * places that can be shown, otherwise a fresh one over `liked`.
 */
export function restoreDuel(saved: SoloDuel | undefined, liked: string[]): SoloDuel {
  const valid =
    saved &&
    Array.isArray(saved.ids) &&
    saved.ids.length === liked.length &&
    saved.ids.every((id) => liked.includes(id)) &&
    Number.isInteger(saved.champ) &&
    Number.isInteger(saved.next) &&
    saved.champ >= 0 &&
    saved.champ < saved.ids.length &&
    saved.next >= 1 &&
    saved.next <= saved.ids.length;
  return valid ? saved : { ids: liked, champ: 0, next: 1 };
}
const KEY = 'mo:solo';

function fresh(filters?: SoloFilters): SoloRun {
  return {
    seed: Math.random().toString(36).slice(2, 10),
    index: 0,
    likes: [],
    history: [],
    finished: false,
    at: new Date().toISOString(),
    key: filters ? settingsKey(filters) : undefined,
    filters: filters ? soloFilters(filters) : undefined,
  };
}
export function newSoloRun(filters?: SoloFilters) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(fresh(filters)));
  } catch {
    /* ignore */
  }
}
export function loadSoloRun(): SoloRun | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    return null;
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
