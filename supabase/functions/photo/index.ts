// GET /functions/v1/photo?id=<placeId>
// Serves one 800px photo per restaurant. The first request fetches it from the Places Photos
// endpoint and stores it in the public "photos" bucket; every later request is a cheap redirect
// to the cached file (plus browser/CDN caching), so each photo hits Google at most once.
import { adminClient } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/http.ts';

const YEAR = 'public, max-age=31536000, immutable';
let placesCache: { at: number; map: Map<string, string> } | null = null;

async function photoNameFor(id: string): Promise<string | null> {
  if (!placesCache || Date.now() - placesCache.at > 10 * 60 * 1000) {
    const sb = adminClient();
    const { data, error } = await sb.storage.from('data').download('restaurants.full.json');
    if (error || !data) return null;
    const full = JSON.parse(await data.text());
    placesCache = { at: Date.now(), map: new Map(full.restaurants.map((r: { id: string; photo: string }) => [r.id, r.photo])) };
  }
  return placesCache.map.get(id) ?? null;
}

function notFound(msg: string) {
  return new Response(msg, { status: 404, headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return notFound('bad id');

  const sb = adminClient();
  const path = `${id}.jpg`;
  const publicUrl = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;

  // 1) Already cached? -> redirect (no Google call)
  const head = await fetch(publicUrl, { method: 'HEAD' });
  if (head.ok) {
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: publicUrl, 'Cache-Control': YEAR } });
  }

  // 2) Only ids that exist in our seeded data can trigger a Google call (prevents abuse).
  const name = await photoNameFor(id);
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
