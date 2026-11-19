import type { CuisineKey } from './types';

export const CUISINES: Record<CuisineKey, { label: string; emoji: string; from: string; to: string }> = {
  italian: { label: 'איטלקי', emoji: '🍝', from: '#F7C59F', to: '#E4572E' },
  pizza: { label: 'פיצה', emoji: '🍕', from: '#FFD166', to: '#EF476F' },
  sushi: { label: 'סושי', emoji: '🍣', from: '#FFB4A2', to: '#E5989B' },
  burger: { label: 'המבורגר', emoji: '🍔', from: '#FFC971', to: '#C8553D' },
  asian: { label: 'אסייתי', emoji: '🥢', from: '#F4A259', to: '#BC4B51' },
  middle_eastern: { label: 'מזרח תיכוני', emoji: '🧆', from: '#E9C46A', to: '#8AB17D' },
  meat: { label: 'בשרים', emoji: '🥩', from: '#E76F51', to: '#9B2226' },
  vegetarian: { label: 'צמחוני', emoji: '🥗', from: '#B5E48C', to: '#52B69A' },
  cafe: { label: 'בית קפה', emoji: '☕', from: '#E6CCB2', to: '#9C6644' },
  bar: { label: 'בר ופאב', emoji: '🍺', from: '#FFD27F', to: '#B5651D' },
  other: { label: 'אחר', emoji: '🍽️', from: '#FFE8D6', to: '#CB997E' },
};

export const CUISINE_ORDER: CuisineKey[] = ['pizza', 'burger', 'sushi', 'asian', 'italian', 'middle_eastern', 'meat', 'vegetarian', 'cafe', 'bar', 'other'];

// Bars and gastropubs that the current data file (seeded before the seed knew
// Google's bar types) still files under "other". Name-only, and only for
// "other", so a labeled restaurant never moves.
const BAR_NAME = /(^|[\s|\-–])[הו]?(פאב|בר|גסטרופאב|מבשלת|בירה)($|[\s|\-–])|\b(pub|gastropub|brew(ing|ery|pub)?|beer|ale|lager|whisk(e)?y|taproom|tavern)\b|וויסקי/i;
const NOT_A_BAR = /גריל בר|סנדוויץ'? בר|בר דגים|grill bar|sandwich bar/i;
/** Next seed: Google's bar types map to "bar" (seedCore deriveCuisine). */
const KNOWN_BARS = /פורט סעיד|port said|פורטר אנד סאנס|porter (&|and) sons/i;

export function refineCuisine(name: string, cuisine: CuisineKey): CuisineKey {
  if (cuisine !== 'other' || !name) return cuisine;
  if (NOT_A_BAR.test(name)) return cuisine;
  if (KNOWN_BARS.test(name) || BAR_NAME.test(name)) return 'bar';
  return cuisine;
}
