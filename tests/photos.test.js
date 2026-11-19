import assert from 'node:assert/strict';
import test from 'node:test';
import { photoCountOf, photoCreditOf, photoQuery } from '../src/lib/photos.ts';
import { MAX_PHOTOS, parsePhotoIndex, photoNamesFromRecord, photoStoragePath } from '../supabase/functions/_shared/photos.js';

test('old restaurant files stay single-photo', () => {
  assert.equal(photoCountOf({ hasPhoto: true }), 1);
  assert.equal(photoCountOf({ hasPhoto: false }), 0);
  assert.equal(photoCountOf({}), 0);
  assert.equal(photoQuery('abc', 0), 'id=abc');
  assert.equal(photoQuery('abc'), 'id=abc');
});

test('photo count is capped and demo photos win', () => {
  assert.equal(photoCountOf({ hasPhoto: true, photoCount: 9 }), 5);
  assert.equal(photoCountOf({ hasPhoto: true, photoCount: 0 }), 0);
  assert.equal(photoCountOf({ hasPhoto: false, photoCount: 3 }), 3);
  assert.equal(photoCountOf({ hasPhoto: false, demoPhotos: ['/a.svg', '/b.svg', '/c.svg'] }), 3);
  assert.equal(photoQuery('place id', 2), 'id=place%20id&i=2');
});

test('credits fall back to the legacy single author on the first photo only', () => {
  const legacy = { hasPhoto: true, photoAuthor: 'Dana', photoAuthorUri: 'https://example.com/d' };
  assert.deepEqual(photoCreditOf(legacy, 0), { name: 'Dana', uri: 'https://example.com/d' });
  assert.deepEqual(photoCreditOf(legacy, 1), { name: '', uri: '' });
  const next = { photoCredits: [{ name: 'A', uri: '' }, { name: '', uri: 'https://example.com/b' }] };
  assert.equal(photoCreditOf(next, 1).uri, 'https://example.com/b');
});

test('server photo helpers cap refs and keep the legacy cache name', () => {
  assert.equal(MAX_PHOTOS, 5);
  const names = photoNamesFromRecord({
    photos: [
      { name: 'places/p/photos/1' },
      'places/p/photos/2',
      { name: '' },
      null,
      { name: 'places/p/photos/3' },
      { name: 'places/p/photos/4' },
      { name: 'places/p/photos/5' },
      { name: 'places/p/photos/6' },
    ],
  });
  assert.deepEqual(names, [
    'places/p/photos/1',
    'places/p/photos/2',
    'places/p/photos/3',
    'places/p/photos/4',
    'places/p/photos/5',
  ]);
  assert.deepEqual(photoNamesFromRecord({ photo: 'places/p/photos/only' }), ['places/p/photos/only']);
  assert.deepEqual(photoNamesFromRecord({}), []);
  assert.equal(photoStoragePath('ChIJabc', 0), 'ChIJabc.jpg');
  assert.equal(photoStoragePath('ChIJabc', 3), 'ChIJabc-3.jpg');
  assert.equal(parsePhotoIndex(null), 0);
  assert.equal(parsePhotoIndex(''), 0);
  assert.equal(parsePhotoIndex('0'), 0);
  assert.equal(parsePhotoIndex('4'), 4);
  assert.equal(parsePhotoIndex('5'), null);
  assert.equal(parsePhotoIndex('1.5'), null);
  assert.equal(parsePhotoIndex('-1'), null);
  assert.equal(parsePhotoIndex('01'), 1);
});
