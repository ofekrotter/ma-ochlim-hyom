import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CODE_LENGTH, isValidCode, normalizeCode, randomCode } from '../src/lib/backend/types.ts';
import { placesContentFresh as clientFresh, safeHttpsUrl, PLACES_MAX_AGE_MS as clientMax } from '../src/lib/publicSafety.ts';
import {
  ADMIN_FAIL_LIMIT,
  PHOTO_FETCH_DAILY_CAP,
  PLACES_MAX_AGE_MS,
  SEED_DAILY_CAP,
  TRACK_EVENTS,
  adminDecision,
  cacheIsFresh,
  isPlacesPhotoName,
  nextAdminFailure,
  placesContentFresh,
  redactSecrets,
  slidingWindowAllow,
} from '../supabase/functions/_shared/guard.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-19T12:00:00.000Z');

test('room codes are 8 characters, and a legacy 4-character code still validates', () => {
  assert.equal(CODE_LENGTH, 8);
  const code = randomCode();
  assert.equal(code.length, 8);
  assert.equal(isValidCode(code), true);
  assert.equal(/[ILO01]/.test(code), false);
  assert.equal(isValidCode('K7PX'), true);
  assert.equal(isValidCode('K7PXM3QD'), true);
  assert.equal(isValidCode('K7P'), false);
  assert.equal(isValidCode('K7PXM3Q0'), false);
  assert.equal(normalizeCode(' k7px-m3qd!! '), 'K7PXM3QD');
  assert.equal(normalizeCode('ABCDEFGHIJK'), 'ABCDEFGH');
});

test('Places content older than 30 days is not usable, demo data is', () => {
  assert.equal(clientMax, PLACES_MAX_AGE_MS);
  const fresh = new Date(now - 10 * DAY).toISOString();
  const stale = new Date(now - 31 * DAY).toISOString();
  assert.equal(placesContentFresh('google_places', fresh, now), true);
  assert.equal(clientFresh('google_places', fresh, now), true);
  assert.equal(placesContentFresh('google_places', stale, now), false);
  assert.equal(clientFresh('google_places', stale, now), false);
  assert.equal(placesContentFresh('sample', stale, now), true);
  assert.equal(clientFresh('sample', stale, now), true);
  assert.equal(placesContentFresh('google_places', 'not-a-date', now), false);
});

test('photo cache age, names, and secret redaction', () => {
  assert.equal(cacheIsFresh(new Date(now - 10 * DAY).toUTCString(), now), true);
  assert.equal(cacheIsFresh(new Date(now - 31 * DAY).toUTCString(), now), false);
  assert.equal(cacheIsFresh(null, now), true);
  assert.equal(isPlacesPhotoName('places/ChIJabcdefghij/photos/AelY1234abcd'), true);
  assert.equal(isPlacesPhotoName('places/place1/photos/SECRET_1'), true);
  assert.equal(isPlacesPhotoName('places/abc/photos/../../etc'), false);
  assert.equal(isPlacesPhotoName('https://evil.example/photo'), false);
  const leaked = 'Places 403: API key AIzaSyDUMMYKEY1234567890 not valid';
  assert.equal(redactSecrets(leaked).includes('AIza'), false);
  assert.equal(redactSecrets('key=super-secret', 'super-secret').includes('super-secret'), false);
});

test('admin lockout and burst limit', () => {
  assert.equal(ADMIN_FAIL_LIMIT, 8);
  assert.equal(PHOTO_FETCH_DAILY_CAP, 800);
  assert.equal(SEED_DAILY_CAP, 2);
  let row = null;
  for (let i = 0; i < 7; i++) row = nextAdminFailure(row && { fails: row.fails, windowStart: new Date(row.windowStart).toISOString(), lockedUntil: null }, now + i);
  assert.equal(row.lockedUntil, null);
  const eighth = nextAdminFailure(
    { fails: row.fails, windowStart: new Date(row.windowStart).toISOString(), lockedUntil: null },
    now + 7,
  );
  assert.equal(typeof eighth.lockedUntil, 'number');
  const locked = adminDecision({ lockedUntil: new Date(now + 60_000).toISOString() }, now);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterSec > 0, true);
  let stamps = [];
  for (let i = 0; i < 3; i++) {
    const step = slidingWindowAllow(stamps, now, 1000, 3);
    stamps = step.stamps;
    assert.equal(step.ok, true);
  }
  assert.equal(slidingWindowAllow(stamps, now, 1000, 3).ok, false);
});

test('attribution links only allow http(s)', () => {
  assert.equal(safeHttpsUrl('https://maps.google.com/a'), 'https://maps.google.com/a');
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('data:text/html,hi'), null);
  assert.equal(safeHttpsUrl(''), null);
});

test('the migration locks helpers and allow-lists the same events the app sends', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119140000_lock_down_public_access.sql', import.meta.url), 'utf8');
  for (const event of TRACK_EVENTS) assert.match(sql, new RegExp(`'${event}'`));
  assert.match(sql, /revoke all on all functions in schema private from public, anon, authenticated/);
  assert.match(sql, /drop function if exists public\.cleanup_expired_sessions\(\)/);
  assert.match(sql, /drop function if exists public\.session_is_active\(text\)/);
  assert.match(sql, /drop function if exists public\.session_member_count\(text\)/);
  assert.match(sql, /grant execute on function public\.consume_daily_slot\(text, integer\) to service_role/);
  assert.equal(sql.includes('grant execute on function public.consume_daily_slot(text, integer) to anon'), false);
  assert.match(sql, /as restrictive for all to anon, authenticated/);
  assert.match(sql, /data-private/);
  assert.match(sql, /char_length\(p_event\) > 40/);
});
