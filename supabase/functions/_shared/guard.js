// Pure guards shared by the edge functions and node:test.
// No secrets and no network. Caps here are what keep Google calls on the free tier.

/** Google Maps Platform allows caching most Places content for 30 days, not a year. */
export const PLACES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PHOTO_MAX_AGE_MS = PLACES_MAX_AGE_MS;

/** Legacy daily cap (kept for reference; the photo function now uses the monthly cap below). */
export const PHOTO_FETCH_DAILY_CAP = 800;
/**
 * New Google photo downloads per billing month. Google's free usage for the
 * "Place Details Photos" SKU is 1,000 per month (then billed per 1,000), so this
 * leaves ~100 of headroom. Only photo index 0 is ever fetched from Google, and
 * 661 places fit under this. Cached redirects do not spend it.
 */
export const PHOTO_FETCH_MONTHLY_CAP = 900;
/**
 * The ONE photo per place that may be downloaded from Google: the second photo when
 * the place has at least two, else the first. Google's photo 0 is the Maps cover and
 * is usually the storefront or the room; photo 1 is usually a dish. Every other photo
 * is served only if it is already cached (an old cached photo 0 stays a free extra slide).
 * Keep in sync with primaryPhotoIndex in src/lib/photos.ts.
 */
export function googlePhotoIndexFor(photoCount) {
  return Number(photoCount) >= 2 ? 1 : 0;
}
/** Indexes that can ever be fetched from Google (for an early, manifest-free 404). */
export const GOOGLE_PHOTO_INDEXES = [0, 1];
export function googleMayFetchPhoto(index, photoCount) {
  return Number.isInteger(index) && index === googlePhotoIndexFor(photoCount);
}
/** Width requested from Google. Cards are ~400 CSS px wide; 480 keeps egress about 3x lower than 800. */
export const PHOTO_MAX_WIDTH_PX = 480;
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

/**
 * Google Maps Platform free usage resets on the 1st at midnight US Pacific time,
 * so the monthly photo counter is keyed by the Pacific calendar month (YYYY-MM).
 */
export function placesBillingMonth(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
