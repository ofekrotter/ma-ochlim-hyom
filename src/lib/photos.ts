import type { Restaurant } from './types';

/** Matches the cap in supabase/functions/_shared/photos.js. */
export const MAX_CARD_PHOTOS = 5;

type PhotoSource = Pick<Restaurant, 'hasPhoto' | 'photoCount' | 'demoPhotos' | 'photoAuthor' | 'photoAuthorUri' | 'photoCredits'>;

/** How many pictures this card can show. Old files (no photoCount) stay at 0 or 1. */
export function photoCountOf(r: PhotoSource): number {
  if (r.demoPhotos && r.demoPhotos.length > 0) return Math.min(MAX_CARD_PHOTOS, r.demoPhotos.length);
  if (typeof r.photoCount === 'number' && Number.isFinite(r.photoCount)) {
    return Math.max(0, Math.min(MAX_CARD_PHOTOS, Math.floor(r.photoCount)));
  }
  return r.hasPhoto ? 1 : 0;
}

export function photoCreditOf(r: PhotoSource, index = 0): { name: string; uri: string } {
  const listed = r.photoCredits?.[index];
  if (listed && (listed.name || listed.uri)) return { name: listed.name || '', uri: listed.uri || '' };
  if (index === 0 && (r.photoAuthor || r.photoAuthorUri)) return { name: r.photoAuthor || '', uri: r.photoAuthorUri || '' };
  return { name: '', uri: '' };
}

/** Query string for the photo edge function. Index 0 keeps the legacy `?id=` URL. */
export function photoQuery(id: string, index = 0): string {
  const base = `id=${encodeURIComponent(id)}`;
  return index <= 0 ? base : `${base}&i=${index}`;
}

/**
 * The photo a card opens on. Google's photo 0 is the Maps cover, usually the
 * storefront or the room; photo 1 is usually a dish. So places with 2+ Google
 * photos open on photo 1, and that is the only photo the photo function buys from
 * Google. Demo data keeps its own order.
 * Keep in sync with googlePhotoIndexFor in supabase/functions/_shared/guard.js.
 */
export function primaryPhotoIndex(r: PhotoSource): number {
  if (r.demoPhotos && r.demoPhotos.length > 0) return 0;
  return photoCountOf(r) >= 2 ? 1 : 0;
}
