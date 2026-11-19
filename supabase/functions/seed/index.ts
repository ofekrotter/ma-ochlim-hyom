// POST /functions/v1/seed  { "password": "<ADMIN_PASSWORD>" }
// One-click (from /stats) rebuild of the restaurant data from Google Places API (New).
// ~90 Nearby Search calls total. Writes:
//   data/restaurants.json       – public file the app downloads (no photo resource names)
//   data/restaurants.full.json  – server copy with photo names (used by the photo function)
// and clears cached photos so they are refreshed together with the data.
import { runSeed } from '../_shared/seedCore.js';
import { adminClient } from '../_shared/admin.ts';
import { checkPassword, corsHeaders, json } from '../_shared/http.ts';

async function clearPhotos(sb: ReturnType<typeof adminClient>) {
  for (let i = 0; i < 20; i++) {
    const { data } = await sb.storage.from('photos').list('', { limit: 1000 });
    if (!data || data.length === 0) return;
    await sb.storage.from('photos').remove(data.map((f) => f.name));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await checkPassword(req))) return json({ error: 'סיסמה שגויה' }, 401);

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return json({ error: 'GOOGLE_PLACES_API_KEY לא מוגדר ב-Secrets' }, 400);

  const logs: string[] = [];
  try {
    const { full, publicData, stats } = await runSeed({ apiKey, log: (l: string) => logs.push(l) });
    if (publicData.count < 10) return json({ error: 'התקבלו מעט מדי מסעדות — הנתונים הקודמים נשמרו', stats, logs }, 500);
    const sb = adminClient();
    const up = (path: string, data: unknown, cache: string) =>
      sb.storage.from('data').upload(path, new Blob([JSON.stringify(data)], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
        cacheControl: cache,
      });
    const a = await up('restaurants.full.json', full, '60');
    const b = await up('restaurants.json', publicData, '300');
    if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);
    await clearPhotos(sb);
    return json({ ok: true, stats, logs });
  } catch (e) {
    return json({ error: (e as Error).message, logs }, 500);
  }
});
