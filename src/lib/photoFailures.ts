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
 * Carousel slides for a card, in display order: the primary photo first (the food
 * photo, see primaryPhotoIndex), then photo 0, then the rest. A slide that failed
 * (not cached, or the monthly budget is spent) drops out, so a failed primary falls
 * back to a cached photo 0. If every slide failed, the primary stays and shows the
 * cuisine illustration.
 */
export function photoSlides(
  count: number,
  urlFor: (index: number) => string | null,
  isFailed: (url: string) => boolean = isPhotoFailed,
  primary = 0,
): number[] {
  if (count <= 0) return [];
  const first = primary >= 0 && primary < count ? primary : 0;
  const order = [first, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== first)];
  const out = order.filter((i) => {
    const url = urlFor(i);
    return Boolean(url) && !isFailed(url as string);
  });
  return out.length > 0 ? out : [first];
}

/** Same URL with a marker so a retry is not answered from the browser's cache of the failure. */
export function retryUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=1`;
}

export const PHOTO_RETRY_MS = 1500;
