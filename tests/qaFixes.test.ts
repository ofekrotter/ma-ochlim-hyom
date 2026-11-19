// QA pass (Nov 2026): photos, ties, solo duel, filters, coverage, RTL, CSP.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refineCuisine } from '../src/lib/cuisines';
import { nearestRestaurantMeters, outsideCoverage } from '../src/lib/data';
import { cleanAddress } from '../src/lib/format';
import { cutWithTies, resolveVotes, roundChangeNotice, SHORTLIST_MAX, stableHash, TIE_KEEP_MAX, type Voter } from '../src/lib/narrow';
import {
  __setPhotoLoaderForTests,
  classifyResponse,
  MAX_CONCURRENT,
  photoState,
  requestPhoto,
  RETRY_DELAYS_MS,
  stableSlides,
  type LoadOutcome,
  type PhotoStatus,
} from '../src/lib/photoLoader';
import { enqueueSwipe, MAX_QUEUED_SWIPES, photoTapDirection } from '../src/lib/swipeQueue';
import { duelPool, restoreDuel, settingsKey, soloInProgress } from '../src/state/solo';
import { cleanAddress as seedCleanAddress, deriveCuisine } from '../supabase/functions/_shared/seedCore.js';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('photo answers (ORB root cause)', () => {
  it('only an image is a photo; 404s are final; 429/5xx are retried', () => {
    expect(classifyResponse(200, 'image/jpeg')).toBe('ok');
    expect(classifyResponse(200, 'image/svg+xml')).toBe('ok');
    // A text body with 200 (e.g. an SPA fallback) is not a photo.
    expect(classifyResponse(200, 'text/html')).toBe('missing');
    expect(classifyResponse(404, 'text/plain')).toBe('missing');
    expect(classifyResponse(400, 'application/json')).toBe('missing');
    expect(classifyResponse(429, 'text/plain')).toBe('retry');
    expect(classifyResponse(503, null)).toBe('retry');
    expect(classifyResponse(500, null)).toBe('retry');
  });
});

describe('photo loader', () => {
  afterEach(() => {
    __setPhotoLoaderForTests(null);
    vi.useRealTimers();
  });
  const objectUrl = { make: () => 'blob:x', revoke: () => undefined };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('retries a busy (429) photo with backoff instead of giving the card up', async () => {
    vi.useFakeTimers();
    const answers: LoadOutcome[] = [{ kind: 'retry' }, { kind: 'retry' }, { kind: 'ok', blob: new Blob(['x']) }];
    const calls: string[] = [];
    __setPhotoLoaderForTests(async (u) => {
      calls.push(u);
      return answers.shift()!;
    }, objectUrl);
    requestPhoto('/p?id=a&i=1', 0);
    await flush();
    expect(photoState('/p?id=a&i=1').status).toBe('retrying');
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    await flush();
    expect(photoState('/p?id=a&i=1').status).toBe('retrying');
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
    await flush();
    expect(photoState('/p?id=a&i=1')).toEqual({ status: 'ok', src: 'blob:x' });
    expect(calls).toHaveLength(3);
  });

  it('a 404 is final: no retries (no extra photo-function or Google calls)', async () => {
    vi.useFakeTimers();
    let n = 0;
    __setPhotoLoaderForTests(async () => {
      n += 1;
      return { kind: 'missing' };
    }, objectUrl);
    requestPhoto('/p?id=b&i=2', 1);
    requestPhoto('/p?id=b&i=2', 0);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    requestPhoto('/p?id=b&i=2', 0);
    await flush();
    expect(photoState('/p?id=b&i=2').status).toBe('missing');
    expect(n).toBe(1);
  });

  it('gives up after the last retry, and de-duplicates and caps parallel loads', async () => {
    vi.useFakeTimers();
    let running = 0;
    let peak = 0;
    let calls = 0;
    __setPhotoLoaderForTests(async () => {
      calls += 1;
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return { kind: 'retry' };
    }, objectUrl);
    for (let i = 0; i < 10; i++) requestPhoto(`/p?id=c${i}`, 2);
    requestPhoto('/p?id=c0', 0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT);
    expect(calls).toBe(10 * (1 + RETRY_DELAYS_MS.length));
    expect(photoState('/p?id=c0').status).toBe('failed');
  });
});

describe('stable carousel', () => {
  const url = (i: number) => `u${i}`;
  const of = (m: Record<string, PhotoStatus>) => (u: string) => m[u] ?? 'idle';

  it('opens on the food photo while it loads, and waits before showing a count', () => {
    expect(stableSlides(5, url, of({}), 1)).toEqual({ slides: [1], settled: false });
    expect(stableSlides(5, url, of({ u0: 'ok', u2: 'missing' }), 1)).toEqual({ slides: [1, 0], settled: false });
  });

  it('settles once every photo is known, and the count only lists photos that load', () => {
    const r = stableSlides(5, url, of({ u1: 'ok', u0: 'ok', u2: 'missing', u3: 'missing', u4: 'ok' }), 1);
    expect(r).toEqual({ slides: [1, 0, 4], settled: true });
  });

  it('a food photo that is retrying steps aside for a loaded photo 0', () => {
    expect(stableSlides(5, url, of({ u1: 'retrying', u0: 'ok' }), 1).slides).toEqual([0]);
  });

  it('nothing usable → the primary slot (illustration), no dots', () => {
    const r = stableSlides(3, url, of({ u0: 'missing', u1: 'failed', u2: 'missing' }), 1);
    expect(r).toEqual({ slides: [1], settled: true });
  });

  it('no photos → no slides', () => {
    expect(stableSlides(0, url, of({}), 0)).toEqual({ slides: [], settled: true });
  });
});

describe('fair ties in the final vote', () => {
  it('keeps all tied places when that stays within TIE_KEEP_MAX', () => {
    const votes = new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 1]]);
    expect(cutWithTies(['a', 'b', 'c', 'd', 'e'], votes)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(TIE_KEEP_MAX).toBe(6);
  });

  it('QA case: 5 places with 1 vote each are all kept, not the first submitter\'s 3', () => {
    const mutual = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const voters: Voter[] = [
      { memberId: 'first', picks: ['p1', 'p2', 'p3'], required: true },
      { memberId: 'me', picks: ['p4', 'p5'], required: true },
    ];
    expect(resolveVotes(mutual, voters, 'me').ids).toEqual(mutual);
  });

  it('too many ties: like counts, then a room-seeded hash — never submit order or deck order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const votes = new Map(ids.map((id) => [id, 1]));
    const likeCounts = new Map([['h', 3], ['g', 2]]);
    const out = cutWithTies(ids, votes, { likeCounts, seed: 'ROOM:1' });
    expect(out).toHaveLength(SHORTLIST_MAX);
    expect(out.slice(0, 2)).toEqual(['h', 'g']);
    // Same on every phone, whatever order the ballots arrived in.
    expect(cutWithTies([...ids].reverse(), votes, { likeCounts, seed: 'ROOM:1' })).toEqual(out);
    expect(stableHash('x')).toBe(stableHash('x'));
  });

  it('a clear leader still wins outright', () => {
    const votes = new Map([['a', 3], ['b', 2], ['c', 2], ['d', 1]]);
    expect(cutWithTies(['a', 'b', 'c', 'd'], votes)).toEqual(['a', 'b', 'c']);
  });
});

describe('solo result survives a refresh', () => {
  it('keeps the saved duel and winner', () => {
    const saved = { ids: ['a', 'b', 'c'], champ: 2, next: 3 };
    expect(restoreDuel(saved, ['a', 'b', 'c'])).toBe(saved);
    expect(restoreDuel(undefined, ['a', 'b'])).toEqual({ ids: ['a', 'b'], champ: 0, next: 1 });
    expect(restoreDuel({ ids: ['a', 'b'], champ: 5, next: 1 }, ['a', 'b'])).toEqual({ ids: ['a', 'b'], champ: 0, next: 1 });
  });

  it('a place that closed keeps its seat; a new like or undo restarts the duel', () => {
    expect(duelPool(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b'])).toEqual(['a', 'b', 'c']);
    expect(duelPool(['a', 'b'], ['a', 'b', 'd'], ['a', 'b', 'd'], ['a', 'b', 'd'])).toEqual(['a', 'b', 'd']);
    expect(duelPool(['a', 'b'], ['a'], ['a', 'b'], ['a'])).toEqual(['a']);
    expect(duelPool(undefined, ['a'], ['a'], ['a'])).toEqual(['a']);
  });
});

describe('changing filters mid-deck', () => {
  const base = { location: { lat: 32.0775, lng: 34.7745, label: 'x', source: 'area' as const }, radius: 2000, prices: [2, 1] as (1 | 2 | 3)[], cuisines: ['pizza', 'sushi'] as const, minRating: null, sort: 'mixed' as const };
  it('same filters (any order) → same key; a cuisine change → different key', () => {
    const a = settingsKey({ ...base, cuisines: [...base.cuisines] });
    expect(settingsKey({ ...base, prices: [1, 2], cuisines: ['sushi', 'pizza'] })).toBe(a);
    expect(settingsKey({ ...base, cuisines: ['burger'] })).not.toBe(a);
  });
  it('only a started, unfinished deck needs a confirm', () => {
    expect(soloInProgress({ index: 3, finished: false })).toBe(true);
    expect(soloInProgress({ index: 0, finished: false })).toBe(false);
    expect(soloInProgress({ index: 9, finished: true })).toBe(false);
    expect(soloInProgress(null)).toBe(false);
  });
});

describe('location outside coverage', () => {
  const tlv = [{ lat: 32.0775, lng: 34.7745 }];
  it('Eilat is outside even at the widest radius; central Tel Aviv is not', () => {
    expect(outsideCoverage(tlv, 29.5577, 34.9519, 5000)).toBe(true);
    expect(outsideCoverage(tlv, 32.08, 34.78, 5000)).toBe(false);
    expect(nearestRestaurantMeters([], 1, 1)).toBe(Infinity);
    expect(outsideCoverage([], 1, 1, 5000)).toBe(false);
  });
});

describe('swipe queue and RTL paging', () => {
  it('quick presses queue up instead of being dropped, within the cards left', () => {
    let q: ('left' | 'right')[] = [];
    for (let i = 0; i < 5; i++) q = enqueueSwipe(q, 'left', 39);
    expect(q).toHaveLength(5);
    expect(enqueueSwipe(['left'], 'right', 1)).toEqual(['left']);
    let big: ('left' | 'right')[] = [];
    for (let i = 0; i < 50; i++) big = enqueueSwipe(big, 'right', 100);
    expect(big).toHaveLength(MAX_QUEUED_SWIPES);
  });
  it('left half = next photo, right half = previous (matches the RTL dots and deck bar)', () => {
    expect(photoTapDirection(10, 0, 400)).toBe(1);
    expect(photoTapDirection(390, 0, 400)).toBe(-1);
  });
});

describe('copy, addresses and categories', () => {
  it('strips postal codes and the country from addresses', () => {
    expect(cleanAddress('אלנבי 112, תל אביב-יפו, 6581705')).toBe('אלנבי 112, תל אביב-יפו');
    expect(cleanAddress('יגאל אלון 120, תל אביב-יפו, 67443')).toBe('יגאל אלון 120, תל אביב-יפו');
    expect(cleanAddress('הנמל 13, חיפה 3303113, ישראל')).toBe('הנמל 13, חיפה');
    expect(cleanAddress('משה בקר 15, ראשון לציון')).toBe('משה בקר 15, ראשון לציון');
    expect(cleanAddress(undefined)).toBe('');
    expect(seedCleanAddress('אלנבי 112, תל אביב-יפו, 6581705')).toBe('אלנבי 112, תל אביב-יפו');
  });
  it('bars and gastropubs get their own category', () => {
    expect(refineCuisine('לאגר אנד אייל | Lager & Ale', 'other')).toBe('bar');
    expect(refineCuisine('פורט סעיד', 'other')).toBe('bar');
    expect(refineCuisine('פורטר אנד סאנס', 'other')).toBe('bar');
    expect(refineCuisine('מעיין הבירה', 'other')).toBe('bar');
    expect(refineCuisine('וויסקי בר מוזיאון', 'other')).toBe('bar');
    expect(refineCuisine('דיקסי גריל בר', 'other')).toBe('other');
    expect(refineCuisine('ברנרד', 'other')).toBe('other');
    expect(refineCuisine('Pub Pizza', 'pizza')).toBe('pizza');
    expect(deriveCuisine('bar', ['bar', 'restaurant'])).toBe('bar');
    expect(deriveCuisine('pizza_restaurant', ['pizza_restaurant', 'bar'])).toBe('pizza');
  });
  it('a friend restarting or widening the room is told apart', () => {
    expect(roundChangeNotice({ round: 1, radius: 2000 }, { round: 2, radius: 3500 })).toBe('widen');
    expect(roundChangeNotice({ round: 1, radius: 2000 }, { round: 2, radius: 2000 })).toBe('restart');
  });
  it('room copy follows the majority rule, not "both of you"', () => {
    const friend = read('src/pages/Friend.tsx');
    expect(friend).not.toContain('כששניכם אהבתם אותו');
    expect(friend).toContain('רוב המשתתפים');
  });
});

describe('page shell', () => {
  it('confetti workers are allowed by every CSP, and confetti does not need one', () => {
    for (const f of ['vercel.json', 'netlify.toml', 'public/_headers']) expect(read(f)).toContain("worker-src 'self' blob:");
    expect(read('src/components/confetti.ts')).toMatch(/useWorker: false/);
  });
  it('has the standard mobile-web-app-capable meta', () => {
    expect(read('index.html')).toContain('<meta name="mobile-web-app-capable" content="yes" />');
  });
  it('the Google wordmark is an LTR island', () => {
    const meta = read('src/components/Meta.tsx');
    expect(meta).toMatch(/dir="ltr"[^>]*unicode-bidi:isolate/);
  });
  it('photo function: one Google download per photo at a time, burst raised but monthly cap unchanged', () => {
    const fn = read('supabase/functions/photo/index.ts');
    expect(fn).toMatch(/inflight\.get\(path\)/);
    expect(fn).toMatch(/GOOGLE_PER_MINUTE = 20/);
    expect(fn).toMatch(/PHOTO_FETCH_MONTHLY_CAP \}\)/);
  });
});
