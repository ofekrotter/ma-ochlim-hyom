import { describe, expect, it } from 'vitest';
import { buildDeck, orderDeck, passesPrice, passesRating } from '../src/lib/data';

const here = { lat: 32.08, lng: 34.78, label: 'בדיקה', source: 'area' as const };

function place(over: {
  id: string;
  lat?: number;
  lng?: number;
  rating?: number | null;
  ratings?: number;
  price?: 1 | 2 | 3 | null;
}) {
  return {
    id: over.id,
    name: over.id,
    address: '',
    lat: over.lat ?? 32.08,
    lng: over.lng ?? 34.78,
    rating: over.rating === undefined ? 4.4 : (over.rating as number),
    ratings: over.ratings ?? 100,
    price: over.price === undefined ? 2 : over.price,
    cuisine: 'other' as const,
    area: 'tel-aviv',
    hasPhoto: false,
    hours: null,
  };
}

const base = {
  mode: 'solo' as const,
  location: here,
  radius: 5000,
  prices: [] as (1 | 2 | 3)[],
  cuisines: [] as [],
};

describe('price and rating', () => {
  it('keeps a missing price inside a price filter and drops a known other price', () => {
    expect(passesPrice(null, [1])).toBe(true);
    expect(passesPrice(2, [1])).toBe(false);
    expect(passesPrice(1, [1, 2])).toBe(true);
    expect(passesPrice(null, [])).toBe(true);
    const kept = buildDeck(
      [place({ id: 'unknown', price: null }), place({ id: 'cheap', price: 1 }), place({ id: 'pricey', price: 3 })],
      { ...base, prices: [1] },
      'seed',
    ).map((r) => r.id);
    expect(kept.sort()).toEqual(['cheap', 'unknown']);
  });

  it('applies a minimum rating only when one is set', () => {
    expect(passesRating(4.3, 4.3)).toBe(true);
    expect(passesRating(4.29, 4.3)).toBe(false);
    expect(passesRating(undefined, 4.3)).toBe(false);
    expect(passesRating(null, 4.3)).toBe(false);
    expect(passesRating(undefined, null)).toBe(true);
    expect(passesRating(3.9, null)).toBe(true);
    const ids = buildDeck(
      [
        place({ id: 'high', rating: 4.6 }),
        place({ id: 'edge', rating: 4.3 }),
        place({ id: 'low', rating: 4.1 }),
        place({ id: 'blank', rating: null }),
      ],
      { ...base, minRating: 4.3 },
      'seed',
    ).map((r) => r.id);
    expect(ids.sort()).toEqual(['edge', 'high']);
    const all = buildDeck(
      [place({ id: 'blank', rating: null }), place({ id: 'low', rating: 3.9 })],
      { ...base, minRating: null },
      'seed',
    );
    expect(all).toHaveLength(2);
  });

  it('orders a nearest deck by distance and leaves the mixed deck shuffled', () => {
    const cards = [
      { ...place({ id: 'far', lat: 32.11 }), distance: 3000 },
      { ...place({ id: 'near', lat: 32.081 }), distance: 200 },
      { ...place({ id: 'mid', lat: 32.09 }), distance: 1200 },
    ];
    expect(orderDeck(cards, 'nearest', 'seed').map((r) => r.id)).toEqual(['near', 'mid', 'far']);
    const deck = buildDeck(
      [place({ id: 'far', lat: 32.1 }), place({ id: 'near', lat: 32.081 })],
      { ...base, sort: 'nearest' },
      'seed',
    );
    expect(deck[0].id).toBe('near');
    expect(deck[0].distance).toBeLessThan(deck[1].distance);
  });
});
