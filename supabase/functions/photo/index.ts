// GET /functions/v1/photo?id=<placeId>&i=<0-4>
// Serves one photo. Index 0 keeps the original cache file (`<id>.jpg`).
// A cached file younger than 30 days is a redirect, with no rate limit: serving
// the cache costs nothing on Google's side. Older files are deleted (Google's
// 30-day caching limit for Places content).
// Google is called only for ONE photo per place (index 1 when the place has 2+
// photos, else 0 — see googlePhotoIndexFor), only for a photo name that is already
// in our seeded file, and only while the monthly cap (and short in-isolate burst
// caps) still has room. Extra carousel photos are served only if already cached.
// Two requests for the same uncached photo at once share one Google download.
// Error answers are short text; the app loads photos with fetch(), so it can
// tell 404 (not available: show the next photo or the illustration) from 429
// (busy: retry with backoff) instead of an <img> hitting Chrome's ORB block.
// The API key never leaves this function.
import { adminClient } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/http.ts';
import { parsePhotoIndex, photoNamesFromRecord, photoStoragePath } from '../_shared/photos.js';
import {
  PHOTO_FETCH_MONTHLY_CAP,
  PHOTO_MAX_WIDTH_PX,
  cacheIsFresh,
  GOOGLE_PHOTO_INDEXES,
  googleMayFetchPhoto,
  isPlacesPhotoName,
  placesBillingMonth,
  placesContentFresh,
  slidingWindowAllow,
} from '../_shared/guard.js';

const MONTH = 'public, max-age=2592000';
const MAX_BYTES = 1_500_000;

let placesCache: { at: number; map: Map<string, string[]>; fresh: boolean } | null = null;
let requestStamps: number[] = [];
let fetchStamps: number[] = [];
/** Google downloads per minute in this isolate. The monthly cap below is what bounds cost. */
const GOOGLE_PER_MINUTE = 20;

type Bought = { kind: 'ok'; bytes: Uint8Array; type: string } | { kind: 'busy' } | { kind: 'none'; maxAge: number };
/** Same photo asked for twice at once (two friends, one new card): one Google download, both get it. */
const inflight = new Map<string, Promise<Bought>>();

function answer(b: Bought): Response {
  if (b.kind === 'ok') return new Response(b.bytes.slice(), { status: 200, headers: { ...corsHeaders, 'Content-Type': b.type, 'Cache-Control': MONTH } });
  if (b.kind === 'busy') return busy();
  return notFound('photo unavailable', b.maxAge);
}

async function loadManifest(sb: ReturnType<typeof adminClient>) {
  if (placesCache && Date.now() - placesCache.at < 60 * 1000) return placesCache;
  const primary = await sb.storage.from('data-private').download('restaurants.full.json');
  const file = !primary.error && primary.data
    ? primary.data
    : (await sb.storage.from('data').download('restaurants.full.json')).data;
  if (!file) return null;
  const full = JSON.parse(await file.text()) as {
    source?: string;
    generatedAt?: string;
    restaurants?: { id: string; photo?: string; photos?: unknown }[];
  };
  const map = new Map<string, string[]>();
  for (const r of full.restaurants ?? []) map.set(r.id, photoNamesFromRecord(r));
  placesCache = { at: Date.now(), map, fresh: placesContentFresh(full.source ?? 'google_places', full.generatedAt) };
  return placesCache;
}

function notFound(msg: string, maxAge = 60) {
  return new Response(msg, { status: 404, headers: { ...corsHeaders, 'Cache-Control': `public, max-age=${maxAge}` } });
}

/** Transient: the browser may retry soon. Never cached. */
function busy() {
  return new Response('slow down', { status: 429, headers: { ...corsHeaders, 'Cache-Control': 'no-store', 'Retry-After': '30' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return notFound('bad id', 3600);
    const index = parsePhotoIndex(url.searchParams.get('i'));
    if (index === null) return notFound('bad index', 3600);

    const sb = adminClient();
    const path = photoStoragePath(id, index);
    const bucket = sb.storage.from('photos');
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;

    // Saved photo: redirect. No rate limit here, so a busy evening never turns cached photos into placeholders.
    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (head.ok && cacheIsFresh(head.headers.get('last-modified'))) {
      // One day, not a month: the stored file itself is deleted after 30 days.
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: publicUrl, 'Cache-Control': 'public, max-age=86400' } });
    }
    if (head.ok) await bucket.remove([path]);

    // Photos 2–4 are never bought from Google. The app drops this slide.
    if (!GOOGLE_PHOTO_INDEXES.includes(index)) return notFound('not cached', 6 * 3600);

    // The manifest is cached in this isolate for a minute, so this is at most one storage read per minute.
    const manifest = await loadManifest(sb);
    const names = manifest?.map.get(id);
    if (!manifest?.fresh || !names || names.length === 0) return notFound('unknown place', 3600);
    // Only the chosen photo of this place may be fetched; the other of 0/1 is served only from cache.
    if (!googleMayFetchPhoto(index, names.length)) return notFound('not cached', 6 * 3600);
    const name = names[index];
    if (!name || !isPlacesPhotoName(name)) return notFound('unknown place', 3600);

    // Someone is already downloading this exact photo: wait for that instead of a second download.
    const shared = inflight.get(path);
    if (shared) return answer(await shared);
    let settle: (b: Bought) => void = () => undefined;
    inflight.set(path, new Promise<Bought>((resolve) => (settle = resolve)));
    let result: Bought = { kind: 'none', maxAge: 60 };
    try {
      result = await (async (): Promise<Bought> => {
        // Everything below calls Google, so it is rate limited.
        const burst = slidingWindowAllow(requestStamps, Date.now(), 60_000, 60);
        requestStamps = burst.stamps;
        if (!burst.ok) return { kind: 'busy' };

        const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
        if (!key) return { kind: 'none', maxAge: 60 };

        const googleBurst = slidingWindowAllow(fetchStamps, Date.now(), 60_000, GOOGLE_PER_MINUTE);
        fetchStamps = googleBurst.stamps;
        if (!googleBurst.ok) return { kind: 'busy' };

        // Monthly free-usage cap (Google's month: US Pacific). When it is spent, the app shows its placeholder.
        const slot = await sb.rpc('consume_daily_slot', { p_bucket: `photo:${placesBillingMonth()}`, p_limit: PHOTO_FETCH_MONTHLY_CAP });
        if (slot.error || slot.data !== true) return { kind: 'none', maxAge: 3600 };
        const g = await fetch(
          `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${PHOTO_MAX_WIDTH_PX}&key=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!g.ok) return { kind: 'none', maxAge: 60 };
        const type = g.headers.get('content-type') ?? '';
        if (!/^image\/(jpeg|png|webp|gif)(\s|;|$)/i.test(type)) return { kind: 'none', maxAge: 60 };
        const bytes = new Uint8Array(await g.arrayBuffer());
        if (bytes.byteLength < 32 || bytes.byteLength > MAX_BYTES) return { kind: 'none', maxAge: 60 };
        await bucket.upload(path, bytes, { contentType: type, upsert: true, cacheControl: '2592000' });
        return { kind: 'ok', bytes, type };
      })();
    } finally {
      settle(result);
      inflight.delete(path);
    }
    return answer(result);
  } catch {
    return notFound('photo unavailable');
  }
});
