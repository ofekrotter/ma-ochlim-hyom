// POST /functions/v1/seed  { "password": "<ADMIN_PASSWORD>" }
// Rebuilds restaurant data from Google Places API (New). About 90 Nearby Search
// calls. Writes the public list and a private photo manifest, then clears cached
// photos. At most SEED_DAILY_CAP successful runs per UTC day.
import { runSeed } from '../_shared/seedCore.js';
import { adminClient } from '../_shared/admin.ts';
import { checkPassword, corsHeaders, json } from '../_shared/http.ts';
import { SEED_DAILY_CAP, redactSecrets, utcDay } from '../_shared/guard.js';

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
  const auth = await checkPassword(req);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, auth.retryAfter ? { 'Retry-After': String(auth.retryAfter) } : {});
  }

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return json({ error: 'GOOGLE_PLACES_API_KEY לא מוגדר ב-Secrets' }, 400);

  const sb = adminClient();
  const slot = await sb.rpc('consume_daily_slot', { p_bucket: `seed:${utcDay()}`, p_limit: SEED_DAILY_CAP });
  if (slot.error) return json({ error: 'צריך להחיל את מיגרציית האבטחה לפני רענון' }, 503);
  if (slot.data !== true) return json({ error: 'כבר רעננו את הנתונים כמה פעמים היום. מחר אפשר שוב — ככה לא חורגים מהמכסה החינמית של Google.' }, 429);

  const logs: string[] = [];
  const clean = (line: string) => redactSecrets(line, apiKey);
  try {
    const { full, publicData, stats } = await runSeed({ apiKey, log: (l: string) => logs.push(clean(l)) });
    if (publicData.count < 10) {
      return json({ error: 'התקבלו מעט מדי מסעדות — הנתונים הקודמים נשמרו', stats, logs }, 500);
    }
    const up = (bucket: string, path: string, data: unknown, cache: string) =>
      sb.storage.from(bucket).upload(path, new Blob([JSON.stringify(data)], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
        cacheControl: cache,
      });
    const a = await up('data-private', 'restaurants.full.json', full, '60');
    const b = await up('data', 'restaurants.json', publicData, '300');
    if (a.error || b.error) throw new Error(clean((a.error ?? b.error)!.message));
    await sb.storage.from('data').remove(['restaurants.full.json']);
    await clearPhotos(sb);
    return json({ ok: true, stats, logs });
  } catch (e) {
    return json({ error: clean((e as Error).message), logs }, 500);
  }
});
