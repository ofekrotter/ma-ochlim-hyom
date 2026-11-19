// POST /functions/v1/stats  { "password": "<ADMIN_PASSWORD>" }
// Returns aggregate funnel counts for the hidden /stats page.
import { adminClient } from '../_shared/admin.ts';
import { checkPassword, corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = await checkPassword(req);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, auth.retryAfter ? { 'Retry-After': String(auth.retryAfter) } : {});
  }

  const sb = adminClient();
  const { data, error } = await sb.from('event_counts').select('day, event, count').order('day', { ascending: false }).limit(5000);
  if (error) return json({ error: error.message }, 500);

  const totals: Record<string, number> = {};
  for (const r of data ?? []) totals[r.event] = (totals[r.event] ?? 0) + Number(r.count);

  const [{ count: sessions }, meta] = await Promise.all([
    sb.from('sessions').select('code', { count: 'exact', head: true }),
    sb.storage.from('data').download('restaurants.json').then(async ({ data }) => {
      if (!data) return null;
      const j = JSON.parse(await data.text());
      return { generatedAt: j.generatedAt, count: j.count };
    }),
  ]);

  return json({ totals, daily: data ?? [], activeSessions: sessions ?? 0, data: meta });
});
