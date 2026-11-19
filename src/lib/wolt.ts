import { woltVenues, type WoltVenueLink } from '../data/wolt-venues.ts';

/** Sphere distance in meters. */
function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Deep link into Wolt search. There is no free API to place an order, so this
 * only opens Wolt's own search for the restaurant name.
 *
 * City slugs are Wolt delivery areas, checked against
 * https://restaurant-api.wolt.com/v1/cities (country ISR) in Nov 2026:
 *   tel-aviv                      "ת״א, הרצליה והסביבה" — also covers הרצליה and רמת גן
 *   haifa                         "חיפה והקריות"
 *   jerusalem                     "ירושלים"
 *   rishon-lezion-hashfela-area   "אזור ראשון לציון והשפלה"
 * Slugs like ramat-gan or herzliya are not cities on Wolt; those pages come back
 * as a generic "Wolt" title. A place with no matching area uses the country search.
 */
const WOLT_CITIES: { slug: string; lat: number; lng: number; areas: string[]; address: RegExp }[] = [
  { slug: 'tel-aviv', lat: 32.0872, lng: 34.787, areas: ['tel-aviv', 'herzliya', 'ramat-gan'], address: /תל אביב|יפו|הרצליה|רמת גן|גבעתיים/ },
  { slug: 'haifa', lat: 32.81, lng: 35.0418, areas: ['haifa'], address: /חיפה/ },
  { slug: 'jerusalem', lat: 31.7719, lng: 35.207, areas: ['jerusalem'], address: /ירושלים/ },
  { slug: 'rishon-lezion-hashfela-area', lat: 31.9243, lng: 34.799, areas: ['rishon', 'rishon-lezion'], address: /ראשון לציון|ראשון/ },
];

/** Don't guess a city when the pin is this far from every known Wolt area. */
const MAX_CITY_METERS = 25_000;

export interface WoltPlace {
  name: string;
  area?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export function woltCitySlug(place: WoltPlace): string | null {
  const area = place.area?.trim();
  if (area) {
    const byArea = WOLT_CITIES.find((c) => c.areas.includes(area));
    if (byArea) return byArea.slug;
  }
  const address = place.address ?? '';
  const byAddress = WOLT_CITIES.find((c) => c.address.test(address));
  if (byAddress) return byAddress.slug;
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    let best: { slug: string; meters: number } | null = null;
    for (const city of WOLT_CITIES) {
      const meters = metersBetween(place.lat, place.lng, city.lat, city.lng);
      if (!best || meters < best.meters) best = { slug: city.slug, meters };
    }
    if (best && best.meters <= MAX_CITY_METERS) return best.slug;
  }
  return null;
}

/**
 * Venue page when scripts/match-wolt.ts confidently matched this place.
 * No match → null, and the button stays hidden. A name search would open
 * other restaurants, which is worse than no link.
 */
export function woltVenueFor(placeId: string): WoltVenueLink | null {
  return woltVenues[placeId] ?? null;
}

/** Opens the Wolt site (and the app, via their universal link) on a name search. */
export function woltSearchUrl(place: WoltPlace): string {
  const q = encodeURIComponent(place.name.trim());
  const slug = woltCitySlug(place);
  if (!slug) return `https://wolt.com/he/search?q=${q}`;
  return `https://wolt.com/he/isr/${slug}/search?q=${q}`;
}
