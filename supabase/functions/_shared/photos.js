// Photo reference helpers shared by the seed and the photo edge function.
// Plain JS so Node (CLI seed, tests) and Deno (edge functions) can both import it.

/** Hard cap so a re-seed never stores, and the photo function never fetches, more than this. */
export const MAX_PHOTOS = 5;

/**
 * Photo resource names for one restaurant, in display order.
 * Accepts the new `photos: [{ name }]` shape and the legacy single `photo` string.
 */
export function photoNamesFromRecord(record) {
  const names = [];
  if (record && Array.isArray(record.photos)) {
    for (const p of record.photos) {
      const name = typeof p === 'string' ? p : p && p.name;
      if (typeof name === 'string' && name) names.push(name);
      if (names.length >= MAX_PHOTOS) break;
    }
  }
  if (names.length === 0 && record && typeof record.photo === 'string' && record.photo) names.push(record.photo);
  return names;
}

/** Cache object name. Index 0 keeps the historical `${id}.jpg` so existing files stay valid. */
export function photoStoragePath(id, index) {
  return index === 0 ? `${id}.jpg` : `${id}-${index}.jpg`;
}

/**
 * `i` query param. Empty → 0 (legacy URLs). Out of range or junk → null (caller rejects, no Google call).
 */
export function parsePhotoIndex(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n >= MAX_PHOTOS) return null;
  return n;
}
