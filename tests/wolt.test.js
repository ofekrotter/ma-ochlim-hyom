import assert from 'node:assert/strict';
import test from 'node:test';
import { WOLT_CHECKED, WOLT_MATCHED, woltVenues } from '../src/data/wolt-venues.ts';
import { woltCitySlug, woltSearchUrl, woltVenueFor } from '../src/lib/wolt.ts';

test('tel aviv, herzliya and ramat gan share the Wolt tel-aviv area', () => {
  for (const area of ['tel-aviv', 'herzliya', 'ramat-gan']) {
    const url = woltSearchUrl({ name: 'פיצה בלה', area });
    assert.equal(url, 'https://wolt.com/he/isr/tel-aviv/search?q=%D7%A4%D7%99%D7%A6%D7%94%20%D7%91%D7%9C%D7%94');
  }
});

test('haifa, jerusalem and rishon use their own Wolt slugs', () => {
  assert.equal(woltCitySlug({ name: 'x', area: 'haifa' }), 'haifa');
  assert.equal(woltCitySlug({ name: 'x', area: 'jerusalem' }), 'jerusalem');
  assert.equal(woltCitySlug({ name: 'x', area: 'rishon' }), 'rishon-lezion-hashfela-area');
  const url = woltSearchUrl({ name: 'חומוס אבו', area: 'jerusalem' });
  assert.ok(url.startsWith('https://wolt.com/he/isr/jerusalem/search?q='));
  assert.ok(url.includes(encodeURIComponent('חומוס אבו')));
});

test('a Hebrew address maps when the area id is missing', () => {
  assert.equal(woltCitySlug({ name: 'x', address: 'כתובת לדוגמה 12, חיפה' }), 'haifa');
  assert.equal(woltCitySlug({ name: 'x', address: 'רחוב הרצל, ראשון לציון' }), 'rishon-lezion-hashfela-area');
});

test('a pin near Haifa picks haifa even without an area id', () => {
  assert.equal(woltCitySlug({ name: 'x', lat: 32.82, lng: 34.99 }), 'haifa');
});

test('a place with no confident Wolt match has no button, and a matched id opens its venue page', () => {
  assert.equal(woltVenueFor('demo-001'), null);
  assert.equal(woltVenueFor(''), null);
  assert.equal(Object.keys(woltVenues).length, WOLT_MATCHED);
  assert.ok(WOLT_MATCHED > 0);
  assert.ok(WOLT_CHECKED >= WOLT_MATCHED);
  for (const [id, venue] of Object.entries(woltVenues)) {
    assert.equal(venue.url, `https://wolt.com/he/isr/${venue.city}/restaurant/${venue.slug}`);
    assert.ok(venue.meters >= 0 && venue.meters <= 400, id);
    assert.ok(venue.name && venue.slug && venue.city);
  }
  const [id, venue] = Object.entries(woltVenues)[0];
  assert.equal(woltVenueFor(id)?.url, venue.url);
});

test('a place far from every known Wolt area falls back to the country search', () => {
  const url = woltSearchUrl({ name: 'דגים באילת', area: 'eilat', lat: 29.55, lng: 34.95 });
  assert.equal(url, `https://wolt.com/he/search?q=${encodeURIComponent('דגים באילת')}`);
});
