// Food photo first: one Google photo per place, chosen as photo 1 when the place has 2+.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { googleMayFetchPhoto, googlePhotoIndexFor } from '../supabase/functions/_shared/guard.js';
import { photoSlides } from '../src/lib/photoFailures.ts';
import { primaryPhotoIndex } from '../src/lib/photos.ts';

const photoFn = readFileSync(new URL('../supabase/functions/photo/index.ts', import.meta.url), 'utf8');
const url = (i) => `https://x/functions/v1/photo?id=abc${i ? `&i=${i}` : ''}`;

test('server and app agree on the one photo per place', () => {
  assert.equal(googlePhotoIndexFor(5), 1);
  assert.equal(googlePhotoIndexFor(2), 1);
  assert.equal(googlePhotoIndexFor(1), 0);
  assert.equal(googlePhotoIndexFor(0), 0);
  for (const photoCount of [0, 1, 2, 3, 5]) {
    assert.equal(primaryPhotoIndex({ hasPhoto: true, photoCount }), googlePhotoIndexFor(photoCount), `count ${photoCount}`);
  }
  // Old files with no photoCount: one photo → index 0.
  assert.equal(primaryPhotoIndex({ hasPhoto: true }), 0);
  // Demo data keeps its own order.
  assert.equal(primaryPhotoIndex({ hasPhoto: false, demoPhotos: ['/a.svg', '/b.svg'] }), 0);
});

test('photo 0 of a multi-photo place is never bought from Google', () => {
  assert.equal(googleMayFetchPhoto(0, 5), false);
  assert.equal(googleMayFetchPhoto(1, 5), true);
  assert.equal(googleMayFetchPhoto(0, 1), true);
  assert.equal(googleMayFetchPhoto(1, 1), false);
  for (const i of [2, 3, 4]) assert.equal(googleMayFetchPhoto(i, 5), false);
  assert.equal(googleMayFetchPhoto(NaN, 5), false);
});

test('the photo function checks the chosen index before any rate limit or Google call', () => {
  const redirect = photoFn.indexOf('status: 302');
  const chosen = photoFn.indexOf('googleMayFetchPhoto(index, names.length)');
  const burst = photoFn.indexOf('slidingWindowAllow(requestStamps');
  const cap = photoFn.indexOf('PHOTO_FETCH_MONTHLY_CAP });');
  const google = photoFn.indexOf('places.googleapis.com');
  assert.ok(redirect > 0 && chosen > redirect && burst > chosen && cap > burst && google > cap);
  assert.match(photoFn, /maxWidthPx=\$\{PHOTO_MAX_WIDTH_PX\}/);
});

test('card opens on the food photo, then a cached photo 0, then the rest', () => {
  assert.deepEqual(photoSlides(5, url, () => false, 1), [1, 0, 2, 3, 4]);
  assert.deepEqual(photoSlides(2, url, () => false, 1), [1, 0]);
  assert.deepEqual(photoSlides(1, url, () => false, 0), [0]);
});

test('if the food photo fails, the card falls back to a cached photo 0', () => {
  assert.deepEqual(photoSlides(5, url, (u) => u === url(1), 1), [0, 2, 3, 4]);
});

test('uncached photo 0 and extras drop out; nothing left → the food photo slot shows the illustration', () => {
  const failed = new Set([url(0), url(2), url(3), url(4)]);
  assert.deepEqual(photoSlides(5, url, (u) => failed.has(u), 1), [1]);
  assert.deepEqual(photoSlides(5, url, () => true, 1), [1]);
});
