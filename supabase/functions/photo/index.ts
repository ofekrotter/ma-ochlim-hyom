// GET /functions/v1/photo?id=<placeId>&i=<0-4>
// Serves one 800px photo. Index 0 keeps the original cache file (`<id>.jpg`).
// A cached file younger than 30 days is a redirect. Older files are deleted.
// Google is called only for a photo name that is already in our seeded file,
// and only while the daily cap (and a short in-isolate burst cap) still has room.
// The API key never leaves this function.
import { adminClient } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/http.ts';
import { parsePhotoIndex, photoNamesFromRecord, photoStoragePath } from '../_shared/photos.js';
import {
  PHOTO_FETCH_DAILY_CAP,
  cacheIsFresh,
  isPlacesPhotoName,
  placesContentFresh,
  slidingWindowAllow,
  utcDay,
} from '../_shared/guard.js';

const MONTH = 'public, max-age=2592000';
const MAX_BYTES = 1_500_000;

let placesCache: { at: number; map: Map<string, string[]>; fresh: boolean } | null = null;
let requestStamps: number[] = [];
let fetchStamps: number[] = [];

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

function notFound(msg: string) {
  return new Response(msg, { status: 404, headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=60' } });
}

function tooMany() {
  return new Response('slow down', { status: 429, headers: { ...corsHeaders, 'Cache-Control': 'no-store', 'Retry-After': '60' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const burst = slidingWindowAllow(requestStamps, Date.now(), 60_000, 60);
    requestStamps = burst.stamps;
    if (!burst.ok) return tooMany();

    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return notFound('bad id');
    const index = parsePhotoIndex(url.searchParams.get('i'));
    if (index === null) return notFound('bad index');

    const sb = adminClient();
    const path = photoStoragePath(id, index);
    const bucket = sb.storage.from('photos');
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;

    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (head.ok && cacheIsFresh(head.headers.get('last-modified'))) {
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: publicUrl, 'Cache-Control': MONTH } });
    }
    if (head.ok) await bucket.remove([path]);

    const manifest = await loadManifest(sb);
    const name = manifest?.map.get(id)?.[index];
    if (!manifest?.fresh || !name || !isPlacesPhotoName(name)) return notFound('unknown place');

    const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!key) return notFound('photo unavailable');

    const googleBurst = slidingWindowAllow(fetchStamps, Date.now(), 60_000, 8);
    fetchStamps = googleBurst.stamps;
    if (!googleBurst.ok) return notFound('photo unavailable');

    const slot = await sb.rpc('consume_daily_slot', { p_bucket: `photo:${utcDay()}`, p_limit: PHOTO_FETCH_DAILY_CAP });
    if (slot.error || slot.data !== true) return notFound('photo unavailable');
    const g = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!g.ok) return notFound('photo unavailable');
    const type = g.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp|gif)(\s|;|$)/i.test(type)) return notFound('photo unavailable');
    const bytes = new Uint8Array(await g.arrayBuffer());
    if (bytes.byteLength < 32 || bytes.byteLength > MAX_BYTES) return notFound('photo unavailable');
    await bucket.upload(path, bytes, { contentType: type, upsert: true, cacheControl: '2592000' });
    return new Response(bytes, { status: 200, headers: { ...corsHeaders, 'Content-Type': type, 'Cache-Control': MONTH } });
  } catch {
    return notFound('photo unavailable');
  }
});
