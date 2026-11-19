import { HAS_SUPABASE, SUPABASE_URL, DECK_LIMIT } from './config';
import { haversine } from './geo';
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
      for (const src of sources) {
        const d = await fetchJson(src);
        if (d) return d;
      }
      throw new Error('no-data');
    })();
    cache.catch(() => (cache = null));
  }
  return cache;
}

export function photoUrl(r: Pick<Restaurant, 'id' | 'hasPhoto'>, source: RestaurantData['source']): string | null {
  if (!HAS_SUPABASE || !r.hasPhoto || source !== 'google_places') return null;
  return `${SUPABASE_URL}/functions/v1/photo?id=${encodeURIComponent(r.id)}`;
}

/** Location + radius + price filter (cuisine applied separately so we can count per cuisine). */
export function filterBase(all: Restaurant[], s: Pick<Settings, 'location' | 'radius' | 'prices'>): DeckCard[] {
  if (!s.location) return [];
  const { lat, lng } = s.location;
  const out: DeckCard[] = [];
  for (const r of all) {
    const distance = haversine(lat, lng, r.lat, r.lng);
    if (distance > s.radius) continue;
    // Missing price ("unknown") is included in every price filter.
    if (s.prices.length > 0 && r.price !== null && !s.prices.includes(r.price)) continue;
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

/** Builds the card order. Deterministic for a given seed (friend mode uses session code + round). */
export function buildDeck(all: Restaurant[], s: Settings, seed: string): DeckCard[] {
  const filtered = filterCuisine(filterBase(all, s), s.cuisines);
  // Favor well-known places a bit: take the strongest 2×limit by a popularity score, then shuffle.
  const scored = filtered
    .map((r) => ({ r, score: r.rating * Math.log10(10 + r.ratings) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_LIMIT * 2)
    .map((x) => x.r);
  return seededShuffle(scored, seed).slice(0, DECK_LIMIT);
}

/** Rebuild a stored deck (list of ids) against the current data and a location. */
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
