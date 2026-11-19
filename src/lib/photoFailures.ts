// Remembers, for this page load, which photo URLs could not be shown after a retry.
// Extra carousel photos that are not cached return 404 from the photo function;
// the carousel drops those slides instead of showing a broken or empty frame.
import { useSyncExternalStore } from 'react';

const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function markPhotoFailed(url: string | null | undefined) {
  if (!url || failed.has(url)) return;
  failed.add(url);
  version += 1;
  for (const l of listeners) l();
}

export function isPhotoFailed(url: string | null | undefined): boolean {
  return Boolean(url && failed.has(url));
}

/** Test helper. */
export function resetPhotoFailures() {
  failed.clear();
  version += 1;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-renders the caller whenever a photo is marked failed. */
export function usePhotoFailures(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/**
 * Carousel slides for a card: photo 0 always stays (it falls back to the cuisine
 * illustration), extra photos stay only while they have not failed.
 */
export function photoSlides(count: number, urlFor: (index: number) => string | null, isFailed: (url: string) => boolean = isPhotoFailed): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push(0);
      continue;
    }
    const url = urlFor(i);
    if (url && !isFailed(url)) out.push(i);
  }
  return out;
}

/** Same URL with a marker so a retry is not answered from the browser's cache of the failure. */
export function retryUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=1`;
}

export const PHOTO_RETRY_MS = 1500;
