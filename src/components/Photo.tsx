import { useCallback, useEffect, useState } from 'react';
import { CUISINES } from '../lib/cuisines';
import { photoUrl } from '../lib/data';
import { photoCountOf } from '../lib/photos';
import type { CuisineKey, Restaurant, RestaurantData } from '../lib/types';

/** Restaurant photo with a cuisine illustration fallback (no photo / failed load / no backend yet). */
export function Photo({ src, cuisine, alt, className = '', eager = false }: { src: string | null; cuisine: CuisineKey; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const c = CUISINES[cuisine] ?? CUISINES.other;
  const showImg = Boolean(src) && !failed;
  const loaded = Boolean(src) && loadedSrc === src;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${c.from}, ${c.to})` }}>
      {(!showImg || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="text-[min(34vw,140px)] drop-shadow-[0_8px_16px_rgb(0_0_0/0.18)]">{c.emoji}</span>
        </div>
      )}
      {showImg && loadedSrc && loadedSrc !== src && (
        <img src={loadedSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {showImg && src && (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

/** Tinder-style segments. Past and current are filled; upcoming stays dim. */
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

export function usePhotoIndex(count: number) {
  const [index, setIndex] = useState(0);
  const step = useCallback((dir: -1 | 1) => {
    setIndex((i) => {
      const n = i + dir;
      if (n < 0 || n >= count) return i;
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
  const count = photoCountOf(restaurant);
  const { index, step } = usePhotoIndex(count);
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);
  const src = photoUrl(restaurant, source, index);
  const label = count > 1 ? `${alt}, תמונה ${index + 1} מתוך ${count}` : alt;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Photo src={src} cuisine={cuisine} alt={label} className="absolute inset-0" eager={eager || index === 0} />
      <PhotoBars count={count} index={index} />
      {count > 1 && (
        <div className="absolute inset-0 z-10 flex" dir="ltr">
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה קודמת" disabled={index === 0} onClick={() => step(-1)} />
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה הבאה" disabled={index === count - 1} onClick={() => step(1)} />
        </div>
      )}
    </div>
  );
}
