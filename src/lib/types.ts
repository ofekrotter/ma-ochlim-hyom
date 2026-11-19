export type CuisineKey =
  | 'italian' | 'pizza' | 'sushi' | 'burger' | 'asian' | 'middle_eastern' | 'meat' | 'vegetarian' | 'cafe' | 'other';

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
  photoAuthor?: string;
  photoAuthorUri?: string;
}

export interface RestaurantData {
  generatedAt: string;
  source: 'google_places' | 'sample';
  count: number;
  restaurants: Restaurant[];
}

export type Mode = 'solo' | 'friend';

export interface LocationChoice {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'area';
  areaId?: string;
}

export interface Settings {
  mode: Mode;
  location: LocationChoice | null;
  radius: number; // meters
  prices: (1 | 2 | 3)[]; // empty = all
  cuisines: CuisineKey[]; // empty = all
}

export interface DeckCard extends Restaurant {
  distance: number; // meters from the chosen location
}
