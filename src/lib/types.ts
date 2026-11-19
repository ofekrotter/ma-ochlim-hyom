import type { OpeningPeriod } from './hours';

export type CuisineKey =
  | 'italian' | 'pizza' | 'sushi' | 'burger' | 'asian' | 'middle_eastern' | 'meat' | 'vegetarian' | 'cafe' | 'other';

export type { OpeningPeriod };

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  ratings: number;
  price: 1 | 2 | 3 | null;
  cuisine: CuisineKey;
  area: string;
  hasPhoto: boolean;
  /** How many photos the photo function can serve. Omitted on old data → 1 if hasPhoto else 0. */
  photoCount?: number;
  /** Per-photo attribution, parallel to photo indexes. Old data uses photoAuthor only. */
  photoCredits?: { name: string; uri: string }[];
  /** Sample-data images. Real Places data uses the photo function instead. */
  demoPhotos?: string[];
  photoAuthor?: string;
  photoAuthorUri?: string;
  /**
   * Weekly periods from Places regularOpeningHours.
   * null or omitted = unknown → the place is still shown.
   * See `isOpenAt` in hours.ts.
   */
  hours?: OpeningPeriod[] | null;
}

export interface RestaurantData {
  generatedAt: string;
  source: 'google_places' | 'sample';
  count: number;
  restaurants: Restaurant[];
  /** Set when Google data was too old to show and the demo list is standing in. */
  notice?: 'stale';
}

export type Mode = 'solo' | 'friend';

export interface LocationChoice {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'area';
  areaId?: string;
}

export type DeckSort = 'mixed' | 'nearest';

export interface Settings {
  mode: Mode;
  location: LocationChoice | null;
  radius: number; // meters
  prices: (1 | 2 | 3)[]; // empty = all
  cuisines: CuisineKey[]; // empty = all
  /** null or omitted = no minimum. A place with no rating is dropped only when this is set. */
  minRating?: number | null;
  /** omitted = popularity shuffle. nearest = closest to the chosen point first. */
  sort?: DeckSort;
}

export interface DeckCard extends Restaurant {
  distance: number; // meters from the chosen location
}
