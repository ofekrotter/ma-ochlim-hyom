import { HAS_SUPABASE, SUPABASE_URL, DECK_LIMIT } from './config';
import { placesContentFresh } from './publicSafety';
import { haversine } from './geo';
import { isOpenAt } from './hours';
import { photoCountOf, photoQuery } from './photos';
import { seededShuffle } from './shuffle';
import type { CuisineKey, DeckCard, Restaurant, RestaurantData, Settings } from './types';

let cache: Promise<RestaurantData> | null = null;

async function fetchJson(url: string): Promise<RestaurantData | null> {
  try {
    const res = await fetch(url, { cache: 'default' });
    if (!res.ok) return null;
    const j = (await res.json()) as RestaurantData;
    return Array.isArray(j?.restaurants) && j.restaurants.length > 0 ? j : null;
  } catch {
    return null;
  }
}

/**
 * Restaurant data, in priority order:
 * 1. Supabase Storage (written by the one-click seed on /stats)
 * 2. /data/restaurants.json bundled with the site (written by `npm run seed`)
 * 3. /data/restaurants.sample.json — demo data so the app works before seeding
 * Zero Google calls happen here.
 */
export function loadRestaurants(): Promise<RestaurantData> {
  if (!cache) {
    cache = (async () => {
      const sources = [
        HAS_SUPABASE ? `${SUPABASE_URL}/storage/v1/object/public/data/restaurants.json` : null,
        '/data/restaurants.json',
        '/data/restaurants.sample.json',
      ].filter(Boolean) as string[];
      let skippedStale = false;
      for (const src of sources) {
        const d = await fetchJson(src);
        if (!d) continue;
        if (!placesContentFresh(d.source, d.generatedAt)) {
          skippedStale = true;
          continue;
        }
        if (skippedStale && d.source === 'sample') return { ...d, notice: 'stale' };
        return d;
      }
      throw new Error('no-data');
    })();
    cache.catch(() => (cache = null));
  }
  return cache;
}

export function photoUrl(r: Pick<Restaurant, 'id' | 'hasPhoto' | 'photoCount' | 'demoPhotos'>, source: RestaurantData['source'], index = 0): string | null {
  const count = photoCountOf(r);
  if (index < 0 || index >= count) return null;
  if (r.demoPhotos && r.demoPhotos[index]) return r.demoPhotos[index];
  if (!HAS_SUPABASE || source !== 'google_places') return null;
  if (!r.hasPhoto && !(typeof r.photoCount === 'number' && r.photoCount > 0)) return null;
  return `${SUPABASE_URL}/functions/v1/photo?${photoQuery(r.id, index)}`;
}

export interface FilterOpts {
  /** When the open/closed check is evaluated. Defaults to now. */
  now?: Date;
  /** Skip the hours check (used to tell "nothing nearby" from "everything is closed"). */
  ignoreHours?: boolean;
}

/** Unknown price stays in every price selection. A chosen price drops only known other levels. */
export function passesPrice(price: Restaurant['price'], selected: readonly (1 | 2 | 3)[]): boolean {
  if (selected.length === 0) return true;
  if (price == null) return true;
  return selected.includes(price);
}

/**
 * No minimum (null, omitted, or 0) keeps every place, including one with no rating.
 * A minimum drops places below it, and places whose rating is missing.
 */
export function passesRating(rating: number | null | undefined, minRating: number | null | undefined): boolean {
  if (minRating == null || !(minRating > 0)) return true;
  return typeof rating === 'number' && Number.isFinite(rating) && rating >= minRating;
}

/** Location + radius + price + rating + open-now (cuisine applied separately so we can count per cuisine). */
export function filterBase(all: Restaurant[], s: Pick<Settings, 'location' | 'radius' | 'prices'> & { minRating?: number | null }, opts?: FilterOpts): DeckCard[] {
  if (!s.location) return [];
  const { lat, lng } = s.location;
  const now = opts?.now ?? new Date();
  const out: DeckCard[] = [];
  for (const r of all) {
    const distance = haversine(lat, lng, r.lat, r.lng);
    if (distance > s.radius) continue;
    if (!passesPrice(r.price, s.prices)) continue;
    if (!passesRating(r.rating, s.minRating)) continue;
    // Missing hours ("unknown") stay. Closed places drop out. See isOpenAt.
    if (!opts?.ignoreHours && !isOpenAt(r.hours, now)) continue;
    out.push({ ...r, distance });
  }
  return out;
}

export function filterCuisine(list: DeckCard[], cuisines: CuisineKey[]): DeckCard[] {
  return cuisines.length === 0 ? list : list.filter((r) => cuisines.includes(r.cuisine));
}

export function cuisineCounts(list: DeckCard[]): Map<CuisineKey, number> {
  const m = new Map<CuisineKey, number>();
  for (const r of list) m.set(r.cuisine, (m.get(r.cuisine) ?? 0) + 1);
  return m;
}

/** Builds the card order. Deterministic for a given seed (friend mode uses session code + round).
 *  `now` freezes open/closed for this deck so a minute boundary can't reshuffle mid-swipe.
 *  Friend decks are stored as ids at this moment; both people then see that same list. */
export function orderDeck(filtered: DeckCard[], sort: Settings['sort'], seed: string): DeckCard[] {
  if (sort === 'nearest') {
    return [...filtered].sort((a, b) => a.distance - b.distance || b.rating - a.rating).slice(0, DECK_LIMIT);
  }
  // Favor well-known places a bit: take the strongest 2×limit by a popularity score, then shuffle.
  const scored = filtered
    .map((r) => ({ r, score: r.rating * Math.log10(10 + (r.ratings || 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_LIMIT * 2)
    .map((x) => x.r);
  return seededShuffle(scored, seed).slice(0, DECK_LIMIT);
}

export function buildDeck(all: Restaurant[], s: Settings, seed: string, now: Date = new Date()): DeckCard[] {
  const filtered = filterCuisine(filterBase(all, s, { now }), s.cuisines);
  return orderDeck(filtered, s.sort, seed);
}

/** Rebuild a stored deck (list of ids). Does not re-check hours: a friend deck is a shared snapshot from when the round was created. */
export function deckFromIds(all: Restaurant[], ids: string[], s: Pick<Settings, 'location'>): DeckCard[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const out: DeckCard[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const distance = s.location ? haversine(s.location.lat, s.location.lng, r.lat, r.lng) : 0;
    out.push({ ...r, distance });
  }
  return out;
}

export function mapsLinks(r: Pick<Restaurant, 'id' | 'name' | 'lat' | 'lng'>) {
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}&query_place_id=${encodeURIComponent(r.id)}`,
    waze: `https://waze.com/ul?ll=${r.lat},${r.lng}&navigate=yes`,
  };
}
