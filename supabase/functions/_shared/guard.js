// Pure guards shared by the edge functions and node:test.
// No secrets and no network. Caps here are what keep Google calls on the free tier.

/** Google Maps Platform allows caching most Places content for 30 days, not a year. */
export const PLACES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PHOTO_MAX_AGE_MS = PLACES_MAX_AGE_MS;

/** New uncached photo downloads per UTC day. Cached redirects do not spend this.
 *  661 places fit under this, and it stays below the 1000/day Google photo quota in the README. */
export const PHOTO_FETCH_DAILY_CAP = 800;
/** Seeds per UTC day. One seed is about 90 Nearby Search calls, so 2 stays under a 200/day quota. */
export const SEED_DAILY_CAP = 2;

export const ADMIN_FAIL_LIMIT = 8;
export const ADMIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_LOCK_MS = 15 * 60 * 1000;

export const TRACK_EVENTS = [
  'app_open',
  'cta_click',
  'mode_selected_solo',
  'mode_selected_friend',
  'location_set',
  'price_selected',
  'cuisine_selected',
  'first_swipe',
  'swipe_like',
  'swipe_skip',
  'session_created',
  'friend_joined',
  'match_found',
  'navigate_clicked',
  'share_clicked',
  'solo_result',
];

/**
 * Places content older than 30 days must not be shown or re-fetched.
 * Non-Google sources (the bundled demo file) are always usable.
 * Allows five minutes of clock skew so a brand-new file is not rejected.
 */
export function placesContentFresh(source, generatedAt, now = Date.now()) {
  if (source && source !== 'google_places') return true;
  const t = Date.parse(generatedAt || '');
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -5 * 60 * 1000 && age <= PLACES_MAX_AGE_MS;
}

/** Missing Last-Modified is treated as fresh so a headerless CDN cannot cause a refetch storm. */
export function cacheIsFresh(lastModified, now = Date.now(), maxAge = PHOTO_MAX_AGE_MS) {
  const t = Date.parse(lastModified || '');
  if (!Number.isFinite(t)) return true;
  const age = now - t;
  return age >= -5 * 60 * 1000 && age < maxAge;
}

/** Photo resource names from our own seed file. Anything else must not be sent to Google. */
export function isPlacesPhotoName(name) {
  return typeof name === 'string'
    && name.length <= 500
    && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)
    && !name.includes('..');
}

export function redactSecrets(text, extra = '') {
  let out = String(text ?? '');
  if (extra) out = out.split(extra).join('[redacted]');
  return out
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[redacted]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
    .slice(0, 240);
}

export function adminDecision(row, now) {
  if (!row) return { allowed: true, retryAfterSec: 0 };
  const locked = row.lockedUntil ? Date.parse(row.lockedUntil) : NaN;
  if (Number.isFinite(locked) && locked > now) {
    return { allowed: false, retryAfterSec: Math.ceil((locked - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function nextAdminFailure(row, now, limit = ADMIN_FAIL_LIMIT, windowMs = ADMIN_WINDOW_MS, lockMs = ADMIN_LOCK_MS) {
  const start = row?.windowStart ? Date.parse(row.windowStart) : NaN;
  const locked = row?.lockedUntil ? Date.parse(row.lockedUntil) : NaN;
  const windowOpen = Number.isFinite(start) && now - start < windowMs && !(Number.isFinite(locked) && locked <= now);
  const fails = windowOpen ? (Number(row.fails) || 0) + 1 : 1;
  return {
    fails,
    windowStart: windowOpen ? start : now,
    lockedUntil: fails >= limit ? now + lockMs : null,
  };
}

/** In-memory burst limit. Returns the next stamp list the caller should keep. */
export function slidingWindowAllow(stamps, now, windowMs, max) {
  const next = (stamps || []).filter((t) => now - t < windowMs);
  if (next.length >= max) return { ok: false, stamps: next };
  next.push(now);
  return { ok: true, stamps: next };
}

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
