import { useCallback, useEffect, useRef, useState } from 'react';
import { CUISINES } from '../lib/cuisines';
import { photoUrl } from '../lib/data';
import { photoCountOf } from '../lib/photos';
import { isPhotoFailed, markPhotoFailed, PHOTO_RETRY_MS, photoSlides, retryUrl, usePhotoFailures } from '../lib/photoFailures';
import type { CuisineKey, Restaurant, RestaurantData } from '../lib/types';

/** Restaurant photo with a cuisine illustration fallback (no photo / failed load / no backend yet). */
export function Photo({ src, cuisine, alt, className = '', eager = false }: { src: string | null; cuisine: CuisineKey; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(() => isPhotoFailed(src));
  // One retry with a short pause (busy photo server, flaky network) before the illustration.
  const [attempt, setAttempt] = useState<0 | 1>(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const c = CUISINES[cuisine] ?? CUISINES.other;
  const imgSrc = src ? (attempt === 0 ? src : retryUrl(src)) : null;
  const showImg = Boolean(imgSrc) && !failed;
  const loaded = Boolean(imgSrc) && loadedSrc === imgSrc;

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setFailed(isPhotoFailed(src));
    setAttempt(0);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [src]);

  const onError = () => {
    if (!src) return;
    if (attempt === 0) {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setAttempt(1), PHOTO_RETRY_MS);
      return;
    }
    setFailed(true);
    markPhotoFailed(src);
  };

  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${c.from}, ${c.to})` }}>
      {(!showImg || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="text-[min(34vw,140px)] drop-shadow-[0_8px_16px_rgb(0_0_0/0.18)]">{c.emoji}</span>
        </div>
      )}
      {showImg && loadedSrc && loadedSrc !== imgSrc && (
        <img src={loadedSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {showImg && imgSrc && (
        <img
          key={imgSrc}
          src={imgSrc}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoadedSrc(imgSrc)}
          onError={onError}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

/** Photo progress segments. Past and current are filled; upcoming stays dim. */
export function PhotoBars({ count, index }: { count: number; index: number }) {
  if (count <= 1) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex gap-1" dir="ltr" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-black/35 shadow-[0_1px_2px_rgb(0_0_0/0.45)]">
          <span className={`block h-full bg-white ${i <= index ? 'w-full' : 'w-0'}`} />
        </span>
      ))}
    </div>
  );
}

/**
 * Photo indexes a card can page through right now. Extra photos that are not
 * cached (the photo function never buys them from Google) drop out once they fail.
 */
export function useCardSlides(restaurant: Pick<Restaurant, 'id' | 'hasPhoto' | 'photoCount' | 'demoPhotos'>, source: RestaurantData['source']): number[] {
  usePhotoFailures();
  return photoSlides(photoCountOf(restaurant), (i) => photoUrl(restaurant, source, i));
}

export function usePhotoIndex(count: number) {
  const [index, setIndex] = useState(0);
  const step = useCallback((dir: -1 | 1) => {
    setIndex((i) => {
      const cur = Math.max(0, Math.min(i, count - 1));
      const n = cur + dir;
      if (n < 0 || n >= count) return cur;
      return n;
    });
  }, [count]);
  return { index, step, setIndex };
}

/**
 * Photo with tap-left / tap-right paging. Used where the card is NOT a swipe surface
 * (final pick, match). The swipe deck handles taps itself so like/dislike drag still works.
 */
export function TappablePhoto({
  restaurant,
  source,
  cuisine,
  alt,
  className = '',
  eager = false,
  onIndexChange,
}: {
  restaurant: Pick<Restaurant, 'id' | 'hasPhoto' | 'photoCount' | 'demoPhotos'>;
  source: RestaurantData['source'];
  cuisine: CuisineKey;
  alt: string;
  className?: string;
  eager?: boolean;
  onIndexChange?: (index: number) => void;
}) {
  const slides = useCardSlides(restaurant, source);
  const count = slides.length;
  const { index: pos, step } = usePhotoIndex(count);
  const slot = Math.min(pos, Math.max(0, count - 1));
  const index = slides[slot] ?? 0;
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);
  const src = photoUrl(restaurant, source, index);
  const label = count > 1 ? `${alt}, תמונה ${slot + 1} מתוך ${count}` : alt;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Photo src={src} cuisine={cuisine} alt={label} className="absolute inset-0" eager={eager || index === 0} />
      <PhotoBars count={count} index={slot} />
      {count > 1 && (
        <div className="absolute inset-0 z-10 flex" dir="ltr">
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה קודמת" disabled={slot === 0} onClick={() => step(-1)} />
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה הבאה" disabled={slot === count - 1} onClick={() => step(1)} />
        </div>
      )}
    </div>
  );
}
