// GET /functions/v1/photo?id=<placeId>&i=<0-4>
// Serves one 800px photo. `i` defaults to 0, which keeps the original URL and the
// original cache file (`<id>.jpg`). Extra pictures are `<id>-<i>.jpg`.
// The first request fetches that one frame from the Places Photos endpoint and stores
// it in the public "photos" bucket; every later request is a cheap redirect to the
// cached file, so each photo hits Google at most once. Indexes that are not in the
// seeded data never trigger a Google call.
import { adminClient } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/http.ts';
import { parsePhotoIndex, photoNamesFromRecord, photoStoragePath } from '../_shared/photos.js';

const YEAR = 'public, max-age=31536000, immutable';
let placesCache: { at: number; map: Map<string, string[]> } | null = null;

async function photoNamesFor(id: string): Promise<string[] | null> {
  if (!placesCache || Date.now() - placesCache.at > 10 * 60 * 1000) {
    const sb = adminClient();
    const { data, error } = await sb.storage.from('data').download('restaurants.full.json');
    if (error || !data) return null;
    const full = JSON.parse(await data.text()) as { restaurants?: { id: string; photo?: string; photos?: unknown }[] };
    const map = new Map<string, string[]>();
    for (const r of full.restaurants ?? []) map.set(r.id, photoNamesFromRecord(r));
    placesCache = { at: Date.now(), map };
  }
  return placesCache.map.get(id) ?? null;
}

function notFound(msg: string) {
  return new Response(msg, { status: 404, headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return notFound('bad id');
  const index = parsePhotoIndex(url.searchParams.get('i'));
  if (index === null) return notFound('bad index');

  const sb = adminClient();
  const path = photoStoragePath(id, index);
  const publicUrl = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;

  // 1) Already cached? -> redirect (no Google call)
  const head = await fetch(publicUrl, { method: 'HEAD' });
  if (head.ok) {
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: publicUrl, 'Cache-Control': YEAR } });
  }

  // 2) Only indexes that exist in our seeded data can trigger a Google call (prevents abuse).
  const names = await photoNamesFor(id);
  const name = names?.[index];
  if (!name) return notFound('unknown place');
  const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!key) return notFound('no key');

  const g = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${encodeURIComponent(key)}`);
  if (!g.ok) return notFound('photo unavailable');
  const bytes = new Uint8Array(await g.arrayBuffer());
  const type = g.headers.get('content-type') ?? 'image/jpeg';
  await sb.storage.from('photos').upload(path, bytes, { contentType: type, upsert: true, cacheControl: '31536000' });

  return new Response(bytes, { status: 200, headers: { ...corsHeaders, 'Content-Type': type, 'Cache-Control': YEAR } });
});
