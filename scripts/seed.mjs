#!/usr/bin/env node
// Seed script (alternative to the one-click button on /stats).
//
//   GOOGLE_PLACES_API_KEY=... npm run seed
//
// Writes public/data/restaurants.json (bundled with the site).
// If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are also set, it uploads the data to Supabase
// Storage too, so the photo function can find photo names. Re-run monthly.
import { writeFile, mkdir } from 'node:fs/promises';
import { runSeed } from '../supabase/functions/_shared/seedCore.js';

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey) {
  console.error('✗ Set GOOGLE_PLACES_API_KEY first, e.g.  GOOGLE_PLACES_API_KEY=xxx npm run seed');
  process.exit(1);
}

console.log('→ Running ~90 Nearby Search calls (one-time, strict field mask)…');
const { full, publicData, stats } = await runSeed({ apiKey, log: (l) => console.log('  ' + l) });
console.log(`→ ${stats.raw} raw results → ${stats.kept} restaurants after dedupe + quality filter (${stats.failed} failed calls)`);
if (publicData.count < 10) {
  console.error('✗ Too few restaurants — not overwriting existing data. Check the key / API enablement.');
  process.exit(1);
}

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/restaurants.json', import.meta.url), JSON.stringify(publicData));
console.log('✓ Wrote public/data/restaurants.json');

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && service) {
  for (const [name, body] of [['restaurants.full.json', full], ['restaurants.json', publicData]]) {
    const res = await fetch(`${url}/storage/v1/object/data/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(body),
    });
    console.log(res.ok ? `✓ Uploaded ${name} to Supabase Storage` : `✗ Upload ${name} failed: ${res.status} ${await res.text()}`);
  }
} else {
  console.log('ℹ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipped upload (photos need the server copy; prefer the button on /stats).');
}
