// Loads card photos with fetch() instead of a bare <img src>.
//
// Why: the photo function answers "not cached" (404), "slow down" (429) and
// "photo unavailable" as small text responses. An <img> pointed at those gets
// blocked by Chrome's ORB (net::ERR_BLOCKED_BY_ORB) and only sees a generic
// error, so the app could not tell "this photo does not exist" from "the server
// is busy for a few seconds". It retried once, then gave the card up for the
// whole page load, and the carousel shrank as slides failed.
//
// Here every photo URL has one shared state:
//   ok        → a blob: URL the <img> shows (no second download)
//   missing   → 400/403/404: not cached / unknown. Permanent for this page load.
//   retrying  → 429, 5xx, network error or timeout: tried again with backoff.
//   failed    → gave up after the retries; asked for again later it starts over.
// Requests are de-duplicated and at most MAX_CONCURRENT run at once, visible
// photos first, so a fast swiper never floods the photo function. Nothing here
// adds Google downloads: a URL is fetched once per page load, plus retries of
// answers that were not photos.
import { useEffect, useSyncExternalStore } from 'react';

export type PhotoStatus = 'idle' | 'loading' | 'retrying' | 'ok' | 'missing' | 'failed';
/** 0 = on screen now, 1 = the open card's other photos, 2 = upcoming cards. */
export type PhotoPriority = 0 | 1 | 2;

export const MAX_CONCURRENT = 4;
/** Waits before retry 1, 2, 3, 4 of a busy/failed answer. About 35 s in total. */
export const RETRY_DELAYS_MS = [1500, 4000, 9000, 20000];
const FETCH_TIMEOUT_MS = 15000;
/** A photo that gave up may be asked for again after this long. */
const FAILED_COOLDOWN_MS = 30000;
/** Blob URLs kept for photos nobody shows right now. */
const KEEP_UNUSED = 60;

interface Entry {
  status: PhotoStatus;
  src: string | null;
  tries: number;
  priority: PhotoPriority;
  refs: number;
  touched: number;
  failedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export type LoadOutcome = { kind: 'ok'; blob: Blob } | { kind: 'missing' } | { kind: 'retry' };

/** How one HTTP answer is treated. Pure, so it is unit-tested. */
export function classifyResponse(status: number, contentType: string | null): 'ok' | 'missing' | 'retry' {
  if (status >= 200 && status < 300) return /^image\//i.test(contentType ?? '') ? 'ok' : 'missing';
  if (status === 400 || status === 403 || status === 404 || status === 410) return 'missing';
  return 'retry';
}

async function defaultLoad(url: string): Promise<LoadOutcome> {
  try {
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const kind = classifyResponse(res.status, res.headers.get('content-type'));
    if (kind !== 'ok') return { kind };
    return { kind: 'ok', blob: await res.blob() };
  } catch {
    return { kind: 'retry' };
  }
}

let loader: (url: string) => Promise<LoadOutcome> = defaultLoad;
let makeObjectUrl: (b: Blob) => string = (b) => URL.createObjectURL(b);
let revokeObjectUrl: (u: string) => void = (u) => URL.revokeObjectURL(u);

const entries = new Map<string, Entry>();
const queue: string[] = [];
let active = 0;
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function entryFor(url: string): Entry {
  let e = entries.get(url);
  if (!e) {
    e = { status: 'idle', src: null, tries: 0, priority: 2, refs: 0, touched: Date.now(), failedAt: 0, timer: null };
    entries.set(url, e);
  }
  return e;
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    // Most urgent first; FIFO within a priority.
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (entryFor(queue[i]).priority < entryFor(queue[best]).priority) best = i;
    }
    const url = queue.splice(best, 1)[0];
    void run(url);
  }
}

async function run(url: string) {
  const e = entryFor(url);
  active += 1;
  let outcome: LoadOutcome;
  try {
    outcome = await loader(url);
  } catch {
    outcome = { kind: 'retry' };
  }
  active -= 1;
  if (entries.get(url) !== e) {
    pump();
    return;
  }
  if (outcome.kind === 'ok') {
    e.status = 'ok';
    e.src = makeObjectUrl(outcome.blob);
    e.touched = Date.now();
    evictUnused();
  } else if (outcome.kind === 'missing') {
    e.status = 'missing';
  } else {
    e.tries += 1;
    const wait = RETRY_DELAYS_MS[e.tries - 1];
    if (wait === undefined) {
      e.status = 'failed';
      e.failedAt = Date.now();
    } else {
      e.status = 'retrying';
      e.timer = setTimeout(() => {
        e.timer = null;
        if (entries.get(url) === e && e.status === 'retrying') {
          queue.push(url);
          pump();
        }
      }, wait);
    }
  }
  emit();
  pump();
}

function evictUnused() {
  const unused = [...entries.entries()].filter(([, e]) => e.status === 'ok' && e.refs === 0);
  if (unused.length <= KEEP_UNUSED) return;
  unused.sort((a, b) => a[1].touched - b[1].touched);
  for (const [url, e] of unused.slice(0, unused.length - KEEP_UNUSED)) {
    if (e.src) revokeObjectUrl(e.src);
    entries.delete(url);
  }
}

/** Start (or re-prioritize) loading a photo. Safe to call on every render. */
export function requestPhoto(url: string | null | undefined, priority: PhotoPriority = 2) {
  if (!url) return;
  const e = entryFor(url);
  e.touched = Date.now();
  if (priority < e.priority) e.priority = priority;
  if (e.status === 'failed' && Date.now() - e.failedAt > FAILED_COOLDOWN_MS) {
    e.status = 'idle';
    e.tries = 0;
  }
  if (e.status !== 'idle') return;
  e.status = 'loading';
  queue.push(url);
  emit();
  pump();
}

export function photoState(url: string | null | undefined): { status: PhotoStatus; src: string | null } {
  if (!url) return { status: 'missing', src: null };
  const e = entries.get(url);
  return e ? { status: e.status, src: e.src } : { status: 'idle', src: null };
}

/** Gone for good (this page load) or given up on. */
export function isDeadStatus(s: PhotoStatus): boolean {
  return s === 'missing' || s === 'failed';
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-renders whenever any photo changes state. */
export function usePhotoLoader(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Loads `url` while mounted and returns its state. */
export function usePhoto(url: string | null, priority: PhotoPriority = 0): { status: PhotoStatus; src: string | null } {
  usePhotoLoader();
  useEffect(() => {
    if (!url) return;
    const e = entryFor(url);
    e.refs += 1;
    requestPhoto(url, priority);
    return () => {
      e.refs = Math.max(0, e.refs - 1);
    };
  }, [url, priority]);
  return photoState(url);
}

/**
 * Carousel slides for one card, in display order, and whether every slide's
 * fate is known yet. Order: the primary (food) photo, then photo 0, then the rest.
 *
 * - Slides that are missing or gave up never show.
 * - Photos that loaded show. The primary shows while it is still on its first
 *   try, so the card does not flash to photo 0 and back.
 * - A primary that is being retried steps aside for a photo that already loaded.
 * - Nothing usable → [primary], which shows the cuisine illustration.
 * The caller shows dots and paging only once `settled`, so the count never
 * shrinks in front of the user.
 */
export function stableSlides(
  count: number,
  urlFor: (index: number) => string | null,
  statusOf: (url: string) => PhotoStatus,
  primary = 0,
): { slides: number[]; settled: boolean } {
  if (count <= 0) return { slides: [], settled: true };
  const first = primary >= 0 && primary < count ? primary : 0;
  const order = [first, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== first)];
  const status = (i: number): PhotoStatus => {
    const u = urlFor(i);
    return u ? statusOf(u) : 'missing';
  };
  const alive = order.filter((i) => !isDeadStatus(status(i)));
  const ok = alive.filter((i) => status(i) === 'ok');
  const settled = order.every((i) => {
    const s = status(i);
    return s === 'ok' || isDeadStatus(s);
  });
  if (alive.length === 0) return { slides: [first], settled };
  const lead = alive[0];
  const leadStatus = status(lead);
  let slides: number[];
  if (leadStatus === 'ok') slides = ok;
  else if (leadStatus === 'retrying' && ok.length > 0) slides = ok;
  else slides = [lead, ...ok];
  return { slides, settled };
}

/** Test hooks. */
export function __setPhotoLoaderForTests(
  fn: ((url: string) => Promise<LoadOutcome>) | null,
  objectUrl?: { make: (b: Blob) => string; revoke: (u: string) => void },
) {
  for (const e of entries.values()) if (e.timer) clearTimeout(e.timer);
  entries.clear();
  queue.length = 0;
  active = 0;
  loader = fn ?? defaultLoad;
  makeObjectUrl = objectUrl?.make ?? ((b) => URL.createObjectURL(b));
  revokeObjectUrl = objectUrl?.revoke ?? ((u) => URL.revokeObjectURL(u));
  emit();
}
