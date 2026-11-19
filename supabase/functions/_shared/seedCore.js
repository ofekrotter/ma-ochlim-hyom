// Shared seed logic for Google Places API (New) — runs in both Node 18+ (scripts/seed.mjs)
// and Deno (supabase/functions/seed). Plain JS on purpose so both runtimes can import it.
//
// Cost design: ONE batch of Nearby Search calls (90), strict field mask, no reviews /
// Atmosphere fields. `regularOpeningHours` is an Enterprise field, the same SKU already
// triggered by rating, userRatingCount and priceLevel, so it does not add calls or a
// higher tier. Photo resource names (up to 5) come back on that same response; the Photos
// media endpoint is not called here. Users never trigger Nearby Search. Extra pictures are
// fetched later, one cached photo call at a time, by the photo function.

import { MAX_PHOTOS } from './photos.js';

export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.primaryType',
  'places.types',
  'places.photos',
  // Enterprise, same SKU as rating/priceLevel. Not currentOpeningHours (stale within a week)
  // and not Atmosphere fields (reviews, serves*, editorialSummary, …).
  'places.regularOpeningHours',
].join(',');

export { MAX_PHOTOS };

// Type groups: each group = one Nearby Search call per grid point (max 20 results per call).
export const TYPE_GROUPS = [
  ['restaurant'],
  ['pizza_restaurant'],
  ['sushi_restaurant', 'japanese_restaurant'],
  ['hamburger_restaurant', 'american_restaurant'],
  ['italian_restaurant'],
  ['asian_restaurant', 'chinese_restaurant', 'thai_restaurant', 'vietnamese_restaurant', 'korean_restaurant', 'ramen_restaurant'],
  ['middle_eastern_restaurant', 'mediterranean_restaurant', 'lebanese_restaurant', 'turkish_restaurant', 'greek_restaurant'],
  ['steak_house', 'barbecue_restaurant'],
  ['vegan_restaurant', 'vegetarian_restaurant'],
  ['cafe', 'coffee_shop', 'brunch_restaurant', 'breakfast_restaurant'],
];

// Grid of center points. Tel Aviv gets a dense grid × all type groups; other cities get a light pass.
export const GRID = [
  // Tel Aviv-Yafo (8 points × 10 groups = 80 calls)
  { area: 'tel-aviv', lat: 32.0525, lng: 34.7565, radius: 1200, groups: 'all' }, // Jaffa
  { area: 'tel-aviv', lat: 32.0575, lng: 34.7700, radius: 1100, groups: 'all' }, // Florentin / Neve Tzedek
  { area: 'tel-aviv', lat: 32.0655, lng: 34.7765, radius: 1100, groups: 'all' }, // Rothschild
  { area: 'tel-aviv', lat: 32.0735, lng: 34.7900, radius: 1100, groups: 'all' }, // Sarona / HaKirya
  { area: 'tel-aviv', lat: 32.0775, lng: 34.7740, radius: 1100, groups: 'all' }, // Dizengoff / center
  { area: 'tel-aviv', lat: 32.0880, lng: 34.7790, radius: 1200, groups: 'all' }, // Old North
  { area: 'tel-aviv', lat: 32.0985, lng: 34.7760, radius: 1200, groups: 'all' }, // Port / Basel
  { area: 'tel-aviv', lat: 32.1120, lng: 34.8020, radius: 1500, groups: 'all' }, // Ramat Aviv
  // Other cities (2 calls each = 10 calls)
  { area: 'ramat-gan', lat: 32.0830, lng: 34.8110, radius: 2000, groups: [0, 9] },
  { area: 'herzliya', lat: 32.1630, lng: 34.8050, radius: 2500, groups: [0, 9] },
  { area: 'jerusalem', lat: 31.7810, lng: 35.2170, radius: 2000, groups: [0, 9] },
  { area: 'haifa', lat: 32.8110, lng: 34.9900, radius: 2500, groups: [0, 9] },
  { area: 'rishon', lat: 31.9700, lng: 34.7900, radius: 2500, groups: [0, 9] },
];

export const MIN_RATING = 3.8;
export const MIN_RATINGS = 30;

const PRICE = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 3,
};

// Ordered rules: first match wins. Keys are mapped to Hebrew labels in the client.
const CUISINE_RULES = [
  ['pizza', ['pizza_restaurant']],
  ['sushi', ['sushi_restaurant']],
  ['burger', ['hamburger_restaurant']],
  ['italian', ['italian_restaurant']],
  ['asian', ['asian_restaurant', 'japanese_restaurant', 'chinese_restaurant', 'thai_restaurant', 'vietnamese_restaurant', 'korean_restaurant', 'ramen_restaurant', 'indian_restaurant', 'indonesian_restaurant']],
  ['meat', ['steak_house', 'barbecue_restaurant']],
  ['middle_eastern', ['middle_eastern_restaurant', 'lebanese_restaurant', 'turkish_restaurant', 'mediterranean_restaurant', 'greek_restaurant', 'afghani_restaurant']],
  ['vegetarian', ['vegan_restaurant', 'vegetarian_restaurant']],
  ['cafe', ['cafe', 'coffee_shop', 'brunch_restaurant', 'breakfast_restaurant', 'bakery']],
];

export function deriveCuisine(primaryType, types) {
  const all = [primaryType, ...(types || [])].filter(Boolean);
  // primaryType gets priority
  for (const [key, list] of CUISINE_RULES) if (primaryType && list.includes(primaryType)) return key;
  for (const [key, list] of CUISINE_RULES) if (all.some((t) => list.includes(t))) return key;
  return 'other';
}

export function buildCalls() {
  const calls = [];
  for (const p of GRID) {
    const idx = p.groups === 'all' ? TYPE_GROUPS.map((_, i) => i) : p.groups;
    for (const i of idx) calls.push({ area: p.area, lat: p.lat, lng: p.lng, radius: p.radius, includedTypes: TYPE_GROUPS[i] });
  }
  return calls;
}

function num(n) {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Places `regularOpeningHours` → compact periods, or null when Places has no hours.
 * null means "unknown" and the app keeps the restaurant.
 * A period with no `close` means open 24 hours (Places' always-open encoding).
 * Each period is [openDay, openHour, openMinute, closeDay, closeHour, closeMinute].
 * closeDay -1 is the 24-hour sentinel.
 */
export function compactHours(regularOpeningHours) {
  const periods = regularOpeningHours && regularOpeningHours.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;
  for (const p of periods) {
    if (p && p.open && !p.close && Number.isFinite(p.open.day)) {
      return [[num(p.open.day), num(p.open.hour), num(p.open.minute), -1, 0, 0]];
    }
  }
  const out = [];
  for (const p of periods) {
    if (!p || !p.open || !p.close) continue;
    if (!Number.isFinite(p.open.day) || !Number.isFinite(p.close.day)) continue;
    out.push([
      num(p.open.day), num(p.open.hour), num(p.open.minute),
      num(p.close.day), num(p.close.hour), num(p.close.minute),
    ]);
  }
  return out.length ? out : null;
}

/** Up to MAX_PHOTOS photo refs. Resource names stay server-side. */
export function compactPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  const out = [];
  for (const p of photos) {
    if (!p || !p.name) continue;
    const author = (p.authorAttributions && p.authorAttributions[0]) || null;
    out.push({
      name: p.name,
      author: author && author.displayName ? author.displayName : '',
      uri: author && author.uri ? author.uri : '',
    });
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

export function cleanPlace(p, area) {
  const photos = compactPhotos(p.photos);
  if (photos.length === 0) return null;
  if (typeof p.rating !== 'number' || p.rating < MIN_RATING) return null;
  if (!p.userRatingCount || p.userRatingCount < MIN_RATINGS) return null;
  if (!p.location) return null;
  const first = photos[0];
  return {
    id: p.id,
    name: (p.displayName && p.displayName.text) || '',
    address: p.formattedAddress || '',
    lat: Number(p.location.latitude.toFixed(6)),
    lng: Number(p.location.longitude.toFixed(6)),
    rating: p.rating,
    ratings: p.userRatingCount,
    price: PRICE[p.priceLevel] ?? null, // null = unknown -> included in every price filter
    cuisine: deriveCuisine(p.primaryType, p.types),
    area,
    photo: first.name, // server-side only (stripped from the public file); first photo, legacy field
    photos, // server-side only
    photoAuthor: first.author,
    photoAuthorUri: first.uri,
    // null = Places had no regularOpeningHours → client keeps the place
    hours: compactHours(p.regularOpeningHours),
  };
}

/** Browser copy: no photo resource names. `photo` (singular) is kept only in the server file. */
export function toPublicRestaurant(r) {
  const { photo, photos, ...rest } = r;
  const photoCredits = (photos || [])
    .map((p) => ({ name: p.author || '', uri: p.uri || '' }))
    .filter((c) => c.name || c.uri);
  const pub = {
    ...rest,
    hasPhoto: Boolean(photo),
    photoCount: photos && photos.length ? photos.length : photo ? 1 : 0,
  };
  if (photoCredits.length) pub.photoCredits = photoCredits;
  return pub;
}

async function nearby(apiKey, call, fetchImpl) {
  const res = await fetchImpl('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: call.includedTypes,
      maxResultCount: 20,
      languageCode: 'he',
      regionCode: 'IL',
      locationRestriction: { circle: { center: { latitude: call.lat, longitude: call.lng }, radius: call.radius } },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.places || [];
}

/**
 * Runs the full seed. Returns { full, publicData, stats }.
 * full: includes photo resource names (keep server-side)
 * publicData: what the browser downloads (no photo resource names)
 */
/** @param {{ apiKey: string, fetchImpl?: typeof fetch, log?: (line: string) => void, concurrency?: number, maxCalls?: number }} opts */
export async function runSeed({ apiKey, fetchImpl = fetch, log = (_line) => {}, concurrency = 5, maxCalls = 100 }) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is missing');
  const calls = buildCalls().slice(0, maxCalls);
  const byId = new Map();
  let raw = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < calls.length) {
      const call = calls[next++];
      try {
        const places = await nearby(apiKey, call, fetchImpl);
        raw += places.length;
        for (const p of places) {
          if (byId.has(p.id)) continue;
          const c = cleanPlace(p, call.area);
          if (c) byId.set(p.id, c);
        }
        log(`✓ ${call.area} [${call.includedTypes[0]}] → ${places.length}`);
      } catch (e) {
        failed++;
        log(`✗ ${call.area} [${call.includedTypes[0]}] ${e.message}`);
        const m = String(e.message);
        // Bad / unrestricted-wrong key or API not enabled: stop immediately instead of burning calls.
        if (m.includes('Places 403') || m.includes('API_KEY_INVALID') || m.includes('API key not valid')) throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const restaurants = [...byId.values()].sort((a, b) => b.ratings - a.ratings);
  const generatedAt = new Date().toISOString();
  const stats = { calls: calls.length, failed, raw, kept: restaurants.length };
  const full = { generatedAt, source: 'google_places', stats, restaurants };
  const publicData = {
    generatedAt,
    source: 'google_places',
    count: restaurants.length,
    restaurants: restaurants.map(toPublicRestaurant),
  };
  return { full, publicData, stats };
}
