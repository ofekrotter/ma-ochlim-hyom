/** Must match PLACES_MAX_AGE_MS in supabase/functions/_shared/guard.js. */
export const PLACES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Google Places content may be cached for 30 days. Demo data is not Places content.
 * Five minutes of future skew is allowed so a just-written file still loads.
 */
export function placesContentFresh(source: string | undefined, generatedAt: string | undefined, now = Date.now()): boolean {
  if (source && source !== 'google_places') return true;
  const t = Date.parse(generatedAt || '');
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -5 * 60 * 1000 && age <= PLACES_MAX_AGE_MS;
}

/** Only http(s) attribution links. Blocks javascript: and other URLs in photo credits. */
export function safeHttpsUrl(uri: string | undefined | null): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}
