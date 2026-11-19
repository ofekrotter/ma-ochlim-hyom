// Pre-launch hardening: photo budget, photo rate limits, OG URLs, room privacy, realtime pings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GOOGLE_PHOTO_INDEXES,
  PHOTO_FETCH_MONTHLY_CAP,
  PHOTO_MAX_WIDTH_PX,
  googleMayFetchPhoto,
  placesBillingMonth,
} from '../supabase/functions/_shared/guard.js';
import { photoSlides, retryUrl } from '../src/lib/photoFailures.ts';
import { roomSettings, roundCoord } from '../src/lib/geo.ts';

const photoFn = readFileSync(new URL('../supabase/functions/photo/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261119180000_prelaunch_hardening.sql', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('Google photo downloads stay under the 1,000/month free usage', () => {
  assert.ok(PHOTO_FETCH_MONTHLY_CAP <= 950, 'leave headroom under 1,000');
  assert.ok(PHOTO_FETCH_MONTHLY_CAP >= 661, 'every place can still get its first photo');
  assert.deepEqual(GOOGLE_PHOTO_INDEXES, [0]);
  assert.equal(googleMayFetchPhoto(0), true);
  for (const i of [1, 2, 3, 4]) assert.equal(googleMayFetchPhoto(i), false);
  assert.equal(PHOTO_MAX_WIDTH_PX, 480);
  assert.match(photoFn, /photo:\$\{placesBillingMonth\(\)\}/);
  assert.match(photoFn, /PHOTO_FETCH_MONTHLY_CAP/);
  assert.doesNotMatch(photoFn, /utcDay\(\)/, 'no daily photo bucket any more');
  assert.doesNotMatch(photoFn, /maxWidthPx=800/);
});

test('billing month follows US Pacific time (when Google resets free usage)', () => {
  // 1 Dec 05:00 UTC is still 30 Nov in California.
  assert.equal(placesBillingMonth(Date.parse('2026-12-01T05:00:00Z')), '2026-11');
  assert.equal(placesBillingMonth(Date.parse('2026-12-01T09:00:00Z')), '2026-12');
  assert.match(placesBillingMonth(), /^\d{4}-\d{2}$/);
});

test('cached photos are redirected before any rate limit; only the Google path is limited', () => {
  const redirect = photoFn.indexOf('status: 302');
  const burst = photoFn.indexOf('slidingWindowAllow(requestStamps');
  const extraGuard = photoFn.indexOf('googleMayFetchPhoto(index)');
  const google = photoFn.indexOf('places.googleapis.com');
  assert.ok(redirect > 0 && burst > 0 && extraGuard > 0 && google > 0);
  assert.ok(redirect < extraGuard, 'cache hit first');
  assert.ok(extraGuard < burst, 'uncached extra photos 404 without spending the limit');
  assert.ok(burst < google, 'burst limit guards the Google call');
});

test('heartbeat-only updates do not ping the room', () => {
  assert.match(migration, /create or replace function private\.notify_room\(\)/);
  assert.match(migration, /\(to_jsonb\(new\) - 'last_seen'\) = \(to_jsonb\(old\) - 'last_seen'\)/);
  assert.match(migration, /tg_table_name = 'session_members'/);
  assert.match(migration, /revoke all on function private\.notify_room\(\) from public, anon, authenticated/);
});

test('Open Graph URLs default to the live site so LinkedIn gets an absolute og:image', () => {
  assert.match(viteConfig, /DEFAULT_SITE_URL = 'https:\/\/ofekrotter-ma-ochlim-lnla\.bolt\.host'/);
  assert.match(viteConfig, /env\.VITE_SITE_URL \|\| DEFAULT_SITE_URL/);
});

test('a near-me point is rounded before it goes into a shared room', () => {
  assert.equal(roundCoord(32.0853123), 32.085);
  assert.equal(roundCoord(34.7817999), 34.782);
  const gps = { mode: 'friend', radius: 2000, location: { lat: 32.0853123, lng: 34.7817999, label: 'המיקום שלי', source: 'gps' } };
  assert.deepEqual(roomSettings(gps).location, { lat: 32.085, lng: 34.782, label: 'המיקום שלי', source: 'gps' });
  const area = { mode: 'friend', radius: 2000, location: { lat: 32.0853123, lng: 34.7817999, label: 'מרכז', source: 'area', areaId: 'x' } };
  assert.equal(roomSettings(area), area, 'area centers are public anyway');
  assert.equal(roomSettings({ location: null }).location, null);
});

test('carousel keeps photo 0 and drops extra photos that failed', () => {
  const url = (i) => `https://x/functions/v1/photo?id=abc&i=${i}`;
  assert.deepEqual(photoSlides(5, url, () => false), [0, 1, 2, 3, 4]);
  const failed = new Set([url(0), url(2), url(4)]);
  assert.deepEqual(photoSlides(5, url, (u) => failed.has(u)), [0, 1, 3]);
  assert.deepEqual(photoSlides(1, url, () => true), [0]);
  assert.deepEqual(photoSlides(0, url, () => false), []);
  assert.deepEqual(photoSlides(3, (i) => (i === 1 ? null : url(i)), () => false), [0, 2]);
});

test('a photo retry is not answered from the cached failure', () => {
  assert.equal(retryUrl('https://x/functions/v1/photo?id=abc'), 'https://x/functions/v1/photo?id=abc&retry=1');
  assert.equal(retryUrl('/demo/a.svg'), '/demo/a.svg?retry=1');
});
