export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} מ׳`;
  return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} ק״מ`;
}

export type GeoResult = { ok: true; lat: number; lng: number } | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };

export function getPosition(): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, reason: 'unsupported' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => resolve({ ok: false, reason: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** ~100 m. Enough to pick restaurants; not someone's exact door. */
export function roundCoord(n: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Settings as stored in a friend room. Anyone with the room link can read them for
 * 24 hours, so a "near me" GPS point is rounded to 3 decimals first.
 */
export function roomSettings<T extends { location: { lat: number; lng: number; source: string } | null }>(s: T): T {
  if (!s.location || s.location.source !== 'gps') return s;
  return { ...s, location: { ...s.location, lat: roundCoord(s.location.lat), lng: roundCoord(s.location.lng) } };
}
