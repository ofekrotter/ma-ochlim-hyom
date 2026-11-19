import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalls, cleanPlace, compactHours, FIELD_MASK, runSeed, toPublicRestaurant } from '../supabase/functions/_shared/seedCore.js';

const PHOTO = (n) => ({
  name: `places/place1/photos/SECRET_${n}`,
  authorAttributions: [{ displayName: `Author ${n}`, uri: `https://maps.example/${n}` }],
});

function place(overrides = {}) {
  return {
    id: 'ChIJabcdefghij1234',
    displayName: { text: 'פיצה' },
    formattedAddress: 'אלנבי 1, תל אביב',
    location: { latitude: 32.066, longitude: 34.774 },
    rating: 4.6,
    userRatingCount: 120,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    primaryType: 'pizza_restaurant',
    types: ['pizza_restaurant', 'restaurant'],
    photos: [PHOTO(1), PHOTO(2), PHOTO(3), PHOTO(4), PHOTO(5), PHOTO(6)],
    regularOpeningHours: {
      openNow: false,
      periods: [
        { open: { day: 4, hour: 18, minute: 0 }, close: { day: 5, hour: 2, minute: 0 } },
        { open: { day: 5, hour: 11, minute: 0 }, close: { day: 5, hour: 15, minute: 0 } },
      ],
    },
    ...overrides,
  };
}

test('a re-seed is exactly 90 Nearby Search calls', () => {
  assert.equal(buildCalls().length, 90);
});

test('field mask adds opening hours on the existing Enterprise SKU and skips Atmosphere fields', () => {
  for (const field of ['places.regularOpeningHours', 'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.photos']) {
    assert.ok(FIELD_MASK.split(',').includes(field), field);
  }
  for (const banned of ['reviews', 'editorialSummary', 'currentOpeningHours', 'servesBeer', 'generativeSummary', 'regularSecondaryOpeningHours', 'goodForChildren']) {
    assert.equal(FIELD_MASK.includes(banned), false, banned);
  }
});

test('compact hours: overnight periods, 24h sentinel, and missing hours', () => {
  assert.deepEqual(
    compactHours({ periods: [{ open: { day: 4, hour: 18, minute: 0 }, close: { day: 5, hour: 2, minute: 0 } }] }),
    [[4, 18, 0, 5, 2, 0]],
  );
  assert.deepEqual(compactHours({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }), [[0, 0, 0, -1, 0, 0]]);
  assert.equal(compactHours(undefined), null);
  assert.equal(compactHours({ periods: [] }), null);
  assert.equal(compactHours({ weekdayDescriptions: ['Monday: Closed'] }), null);
});

test('cleanPlace keeps up to 5 photos and null hours, and drops weak places', () => {
  const kept = cleanPlace(place(), 'tel-aviv');
  assert.equal(kept.photos.length, 5);
  assert.equal(kept.photo, 'places/place1/photos/SECRET_1');
  assert.equal(kept.photos.some((p) => p.name.endsWith('SECRET_6')), false);
  assert.deepEqual(kept.hours, [[4, 18, 0, 5, 2, 0], [5, 11, 0, 5, 15, 0]]);
  assert.equal(kept.price, 2);

  const unknown = cleanPlace(place({ regularOpeningHours: undefined }), 'tel-aviv');
  assert.equal(unknown.hours, null);
  assert.equal(unknown.photos.length, 5);

  assert.equal(cleanPlace(place({ photos: [] }), 'tel-aviv'), null);
  assert.equal(cleanPlace(place({ rating: 3.2 }), 'tel-aviv'), null);
  assert.equal(cleanPlace(place({ userRatingCount: 10 }), 'tel-aviv'), null);
});

test('public file has hours and photo counts but no photo resource names', () => {
  const full = cleanPlace(place(), 'tel-aviv');
  const pub = toPublicRestaurant(full);
  const blob = JSON.stringify(pub);
  assert.equal(blob.includes('SECRET'), false);
  assert.equal(blob.includes('places/'), false);
  assert.equal('photo' in pub, false);
  assert.equal('photos' in pub, false);
  assert.equal(pub.photoCount, 5);
  assert.equal(pub.hasPhoto, true);
  assert.equal(pub.photoCredits.length, 5);
  assert.equal(pub.photoCredits[1].name, 'Author 2');
  assert.deepEqual(pub.hours, full.hours);
  assert.equal(pub.photoAuthor, 'Author 1');

  const noAuthor = toPublicRestaurant(cleanPlace(place({
    photos: [{ name: 'places/place1/photos/SECRET_1' }],
    regularOpeningHours: undefined,
  }), 'tel-aviv'));
  assert.equal(noAuthor.photoCount, 1);
  assert.equal(noAuthor.hours, null);
  assert.equal('photoCredits' in noAuthor, false);
});

test('runSeed makes one Nearby Search per grid call and does not fetch photo media', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      async json() {
        return { places: [place(), place({ id: 'ChIJtoo_few_ratings', userRatingCount: 4 })] };
      },
      async text() {
        return '';
      },
    };
  };
  const { full, publicData, stats } = await runSeed({ apiKey: 'test-key', fetchImpl, maxCalls: 2, concurrency: 2, log() {} });
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes('places:searchNearby')));
  assert.equal(urls.some((u) => u.includes('/media')), false);
  assert.equal(stats.calls, 2);
  assert.equal(stats.kept, 1);
  assert.equal(full.restaurants[0].photos.length, 5);
  assert.equal(publicData.restaurants[0].photoCount, 5);
  assert.equal(JSON.stringify(publicData).includes('SECRET'), false);
  assert.ok(publicData.restaurants[0].hours);
});
