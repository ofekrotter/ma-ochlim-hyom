/**
 * Match the restaurant list to Wolt venues and write src/data/wolt-venues.ts.
 *
 * Uses Wolt's public, unauthenticated search (the same call their website makes):
 *   POST https://restaurant-api.wolt.com/v1/pages/search
 *   { q, target: "venues", lat, lon }
 * No API key and no paid plan. Requests are one at a time with a pause, and a
 * 429 waits and retries. Raw hits are cached in scripts/.wolt-cache.json so a
 * second run only re-matches.
 *
 *   node --experimental-strip-types scripts/match-wolt.ts [restaurants.json]
 *
 * The JSON is a { restaurants: [...] } file, or a Supabase public object URL
 * via SUPABASE_URL (…/storage/v1/object/public/data/restaurants.json).
 * Without either, public/data/restaurants.json in this repo is used.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchWoltVenue, type WoltCandidate } from '../src/lib/woltMatch.ts';
import { woltCitySlug } from '../src/lib/wolt.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = resolve(root, 'scripts/.wolt-cache.json');
const outPath = resolve(root, 'src/data/wolt-venues.ts');
const GAP_MS = 350;
const SEARCH_URL = 'https://restaurant-api.wolt.com/v1/pages/search';

interface Restaurant {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  area?: string;
}

interface CacheHit {
  city: string;
  venues: WoltCandidate[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadRestaurants(): Promise<Restaurant[]> {
  const arg = process.argv[2];
  let text: string;
  if (arg && /^https?:\/\//.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new Error(`fetch ${arg} → ${res.status}`);
    text = await res.text();
  } else if (arg) {
    text = readFileSync(resolve(arg), 'utf8');
  } else if (process.env.SUPABASE_URL) {
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/data/restaurants.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    text = await res.text();
  } else {
    text = readFileSync(resolve(root, 'public/data/restaurants.json'), 'utf8');
  }
  const json = JSON.parse(text) as { restaurants?: Restaurant[] };
  const list = json.restaurants ?? [];
  if (list.length === 0) throw new Error('no restaurants in the input file');
  return list.filter((r) => r.id && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

function readCache(): Record<string, CacheHit> {
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, CacheHit>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheHit>) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
}

async function searchOne(place: Restaurant): Promise<CacheHit> {
  const body = JSON.stringify({
    q: place.name,
    target: 'venues',
    lat: String(place.lat),
    lon: String(place.lng),
  });
  let wait = 2000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        platform: 'Web',
        'app-language': 'he',
        'client-version': '1.16.79',
      },
      body,
    });
    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
      console.warn(`  ${res.status} on ${place.name}, waiting ${pause}ms`);
      await sleep(pause);
      wait = Math.min(wait * 2, 30_000);
      continue;
    }
    if (!res.ok) throw new Error(`search ${place.name} → ${res.status}`);
    const json = (await res.json()) as {
      city?: string;
      sections?: { items?: { venue?: Record<string, unknown> }[] }[];
    };
    const city = json.city || woltCitySlug(place) || '';
    const venues: WoltCandidate[] = [];
    const seen = new Set<string>();
    for (const section of json.sections ?? []) {
      for (const item of section.items ?? []) {
        const v = item.venue;
        if (!v) continue;
        const id = String(v.id ?? '');
        const slug = String(v.slug ?? '');
        const name = String(v.name ?? '');
        const loc = v.location;
        if (!id || !slug || !name || !Array.isArray(loc) || loc.length < 2) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        const lng = Number(loc[0]);
        const lat = Number(loc[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        venues.push({
          id,
          name,
          slug,
          city,
          lat,
          lng,
          productLine: typeof v.product_line === 'string' ? v.product_line : undefined,
        });
      }
    }
    return { city, venues };
  }
  throw new Error(`gave up searching ${place.name} after rate limits`);
}

function writeModule(matches: ReturnType<typeof matchWoltVenue>[], checked: number) {
  const kept = matches.filter((m): m is NonNullable<typeof m> => Boolean(m));
  const entries = kept
    .sort((a, b) => a.placeId.localeCompare(b.placeId))
    .map((m) => {
      const row = {
        slug: m.slug,
        city: m.city,
        name: m.name,
        url: m.url,
        meters: m.meters,
      };
      return `  ${JSON.stringify(m.placeId)}: ${JSON.stringify(row)}`;
    });
  const banner = [
    '/* Generated by scripts/match-wolt.ts. Do not edit by hand.',
    ` * Checked ${checked} restaurants against Wolt public search.`,
    ` * Confident matches: ${kept.length}. Unmatched places have no button.`,
    ` * Generated ${new Date().toISOString()}.`,
    ' */',
    '',
  ].join('\n');
  const body = `export interface WoltVenueLink {
  slug: string;
  city: string;
  name: string;
  url: string;
  meters: number;
}

export const WOLT_MATCHED = ${kept.length};
export const WOLT_CHECKED = ${checked};

export const woltVenues: Record<string, WoltVenueLink> = {
${entries.join(',\n')}
};
`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, banner + body);
  console.log(`wrote ${kept.length} matches of ${checked} to ${outPath}`);
}

async function main() {
  const places = await loadRestaurants();
  const cache = readCache();
  let fetched = 0;
  for (const place of places) {
    if (cache[place.id]) continue;
    const hit = await searchOne(place);
    cache[place.id] = hit;
    fetched++;
    if (fetched % 25 === 0) {
      writeCache(cache);
      console.log(`fetched ${fetched}, cache ${Object.keys(cache).length}/${places.length}`);
    }
    await sleep(GAP_MS);
  }
  writeCache(cache);
  console.log(`cache ready, ${fetched} new searches, ${Object.keys(cache).length} total`);

  const matches = places.map((place) => matchWoltVenue(place, cache[place.id]?.venues ?? []));
  writeModule(matches, places.length);
  const reasons = { matched: matches.filter(Boolean).length, missed: matches.filter((m) => !m).length };
  console.log(reasons);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
