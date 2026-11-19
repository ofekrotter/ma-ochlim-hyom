import assert from 'node:assert/strict';
import test from 'node:test';
import { consonantSkeleton, matchWoltVenue, nameScore, translitScore, woltVenuePage } from '../src/lib/woltMatch.ts';

const place = (over = {}) => ({ id: 'p1', name: 'פרוזדור', lat: 32.0791, lng: 34.7686, ...over });
const venue = (over = {}) => ({
  id: 'v1',
  name: 'פרוזדור',
  slug: 'prozdor-burger',
  city: 'tel-aviv',
  lat: 32.079,
  lng: 34.7685,
  productLine: 'restaurant',
  ...over,
});

test('same name a few meters away is a venue page, not a search', () => {
  const m = matchWoltVenue(place(), [venue()]);
  assert.ok(m);
  assert.equal(m.slug, 'prozdor-burger');
  assert.equal(m.url, 'https://wolt.com/he/isr/tel-aviv/restaurant/prozdor-burger');
  assert.ok(m.meters < 50);
  assert.equal(m.score, 1);
});

test('a different restaurant nearby is not a match', () => {
  const m = matchWoltVenue(place({ name: 'קפה נחת' }), [
    venue({ id: 'other', name: 'קפה נואר', slug: 'cafe-noir', lat: 32.0792, lng: 34.7687 }),
  ]);
  assert.equal(m, null);
});

test('a grocery with the same name does not count', () => {
  const m = matchWoltVenue(place(), [venue({ productLine: 'grocery' })]);
  assert.equal(m, null);
});

test('two similarly named venues in the same block are too ambiguous', () => {
  const m = matchWoltVenue(place({ name: 'סוהו' }), [
    venue({ id: 'a', name: 'סוהו', slug: 'soho-a', lat: 32.07915, lng: 34.76865 }),
    venue({ id: 'b', name: 'סוהו', slug: 'soho-b', lat: 32.0793, lng: 34.7689 }),
  ]);
  assert.equal(m, null);
});

test('the closer branch wins when the other is streets away', () => {
  const m = matchWoltVenue(place({ name: 'גרקו' }), [
    venue({ id: 'far', name: 'גרקו', slug: 'greco-far', lat: 32.082, lng: 34.772 }),
    venue({ id: 'near', name: 'גרקו | הרצליה', slug: 'greco-herzeliya', lat: 32.07912, lng: 34.76862 }),
  ]);
  assert.equal(m?.slug, 'greco-herzeliya');
});

test('Hebrew and English names meet when the pin is the same place', () => {
  assert.equal(consonantSkeleton('פרוזדור'), consonantSkeleton('Prozdor'));
  assert.ok(translitScore('פרוזדור', 'Prozdor') >= 0.8);
  const m = matchWoltVenue(place(), [
    venue({ name: 'Prozdor', slug: 'prozdor-burger', lat: 32.07905, lng: 34.76855 }),
  ]);
  assert.equal(m?.slug, 'prozdor-burger');
});

test('a short cross-script name matches only inside the same building', () => {
  assert.ok(nameScore('Mela', 'מלה') < 0.5);
  const close = matchWoltVenue(place({ name: 'Mela', lat: 32.09, lng: 34.78 }), [
    venue({ name: 'מלה', slug: 'mela', lat: 32.0901, lng: 34.7801 }),
  ]);
  assert.equal(close?.slug, 'mela');
  const far = matchWoltVenue(place({ name: 'Mela', lat: 32.09, lng: 34.78 }), [
    venue({ name: 'מלה', slug: 'mela', lat: 32.095, lng: 34.785 }),
  ]);
  assert.equal(far, null);
});

test('a venue hundreds of meters away with the same name is kept, a kilometer away is not', () => {
  const near = matchWoltVenue(place(), [venue({ lat: 32.081, lng: 34.771 })]);
  assert.ok(near);
  assert.ok(near.meters < 400);
  const far = matchWoltVenue(place(), [venue({ lat: 32.095, lng: 34.79 })]);
  assert.equal(far, null);
});

test('an English name matches the Hebrew venue at the same door, not a different Hebrew place nearby', () => {
  const moon = matchWoltVenue(place({ name: 'Moon Sushi Bar', lat: 32.0756, lng: 34.7721 }), [
    venue({ id: 'far-branch', name: 'מון סושי | פינסקר', slug: 'moon-pinsker', lat: 32.0764, lng: 34.7725 }),
    venue({ id: 'door', name: 'מון סושי | בוגרשוב', slug: 'moon-bograshov', lat: 32.07562, lng: 34.77212 }),
  ]);
  assert.equal(moon?.slug, 'moon-bograshov');
  const street = matchWoltVenue(place({ name: 'נאבי יונה | Nabi Yuna', lat: 32.08, lng: 34.78 }), [
    venue({ id: 'other', name: 'סילי קיד | יונה הנביא', slug: 'silly-kid', lat: 32.0801, lng: 34.7801 }),
  ]);
  assert.equal(street, null);
  const market = matchWoltVenue(place({ name: 'מחניודה', lat: 31.7852, lng: 35.2112 }), [
    venue({ id: 'shawarma', name: 'שווארמה הקצבים | מחנה יהודה', slug: 'not-this', lat: 31.7855, lng: 35.212 }),
  ]);
  assert.equal(market, null);
});

test('venue page url uses the city slug', () => {
  assert.equal(woltVenuePage('haifa', 'fattoush'), 'https://wolt.com/he/isr/haifa/restaurant/fattoush');
});
