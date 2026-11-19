import { useCallback, useEffect, useState } from 'react';
import { CUISINES } from '../lib/cuisines';
import { photoUrl } from '../lib/data';
import { photoCountOf, primaryPhotoIndex } from '../lib/photos';
import { photoState, requestPhoto, stableSlides, usePhoto, usePhotoLoader, type PhotoPriority } from '../lib/photoLoader';
import type { CuisineKey, Restaurant, RestaurantData } from '../lib/types';

type PhotoPlace = Pick<Restaurant, 'id' | 'hasPhoto' | 'photoCount' | 'demoPhotos'>;

/**
 * Restaurant photo with a cuisine illustration fallback (no photo, not cached,
 * still loading, or no backend yet). The bytes come from the shared photo
 * loader, so a busy server is retried and never shows a broken image.
 */
export function Photo({
  src,
  cuisine,
  alt,
  className = '',
  priority = 0,
}: {
  src: string | null;
  cuisine: CuisineKey;
  alt: string;
  className?: string;
  /** Kept for callers; every on-screen photo now loads right away. */
  eager?: boolean;
  priority?: PhotoPriority;
}) {
  const { status, src: blobSrc } = usePhoto(src, priority);
  const [shown, setShown] = useState<string | null>(null);
  const c = CUISINES[cuisine] ?? CUISINES.other;
  const ready = status === 'ok' && Boolean(blobSrc);
  const visible = ready && shown === blobSrc;

  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${c.from}, ${c.to})` }}>
      {!visible && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className={`text-[min(34vw,140px)] drop-shadow-[0_8px_16px_rgb(0_0_0/0.18)] ${status === 'loading' || status === 'retrying' ? 'animate-pulse' : ''}`}>{c.emoji}</span>
        </div>
      )}
      {ready && blobSrc && (
        <img
          key={blobSrc}
          src={blobSrc}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={() => setShown(blobSrc)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!ready && <span className="sr-only">{alt}</span>}
    </div>
  );
}

/**
 * Photo progress segments. Past and current are filled; upcoming stays dim.
 * Follows the page direction (RTL): the first photo is the right-most segment,
 * like the deck progress bar.
 */
export function PhotoBars({ count, index }: { count: number; index: number }) {
  if (count <= 1) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex gap-1" dir="rtl" aria-hidden data-testid="photo-bars">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-black/35 shadow-[0_1px_2px_rgb(0_0_0/0.45)]">
          <span className={`block h-full bg-white ${i <= index ? 'w-full' : 'w-0'}`} />
        </span>
      ))}
    </div>
  );
}

export interface CardSlides {
  /** Photo indexes, in display order. Never empty when the place has photos. */
  slides: number[];
  /** Every photo's fate is known: show dots and paging only then, so the count never shrinks. */
  settled: boolean;
}

/**
 * Photo indexes a card can show. `probe` (the open card, a final card) also asks
 * for the card's other photos so the carousel is known up front; the others are
 * served only if already cached, so this never adds a Google download. Without
 * `probe` only the photo the card opens on is loaded, falling back to the next
 * one if it is not available.
 */
export function useCardSlides(restaurant: PhotoPlace, source: RestaurantData['source'], probe = false, priority: PhotoPriority = 0): CardSlides {
  usePhotoLoader();
  const count = photoCountOf(restaurant);
  const urlFor = (i: number) => photoUrl(restaurant, source, i);
  const result = stableSlides(count, urlFor, (u) => photoState(u).status, primaryPhotoIndex(restaurant));
  const lead = result.slides[0];
  const leadUrl = lead === undefined ? null : urlFor(lead);
  const key = Array.from({ length: count }, (_, i) => urlFor(i) ?? '').join('|');
  useEffect(() => {
    if (leadUrl) requestPhoto(leadUrl, priority);
    if (!probe) return;
    for (const u of key.split('|')) if (u) requestPhoto(u, priority === 0 ? 1 : priority);
  }, [key, leadUrl, probe, priority]);
  return result;
}

/**
 * Which photo a carousel is on, by photo index, so a slide that loads late
 * never moves the picture under the viewer.
 */
export function useSlidePosition(slides: number[]) {
  const [picked, setPicked] = useState<number | null>(null);
  const slot = picked !== null && slides.includes(picked) ? slides.indexOf(picked) : 0;
  const current = slides[slot];
  const step = useCallback(
    (dir: -1 | 1) => {
      const n = slot + dir;
      if (n < 0 || n >= slides.length) return;
      setPicked(slides[n]);
    },
    [slot, slides],
  );
  return { slot, current, step };
}

/**
 * Photo with tap paging. Used where the card is NOT a swipe surface
 * (final pick, shortlist). The swipe deck handles taps itself so dragging still works.
 * RTL: the right half goes back, the left half goes forward.
 */
export function TappablePhoto({
  restaurant,
  source,
  cuisine,
  alt,
  className = '',
  onIndexChange,
}: {
  restaurant: PhotoPlace;
  source: RestaurantData['source'];
  cuisine: CuisineKey;
  alt: string;
  className?: string;
  eager?: boolean;
  /** The photo on screen, or null while only the illustration shows. */
  onIndexChange?: (index: number | null) => void;
}) {
  const { slides, settled } = useCardSlides(restaurant, source, true);
  const { slot, current, step } = useSlidePosition(slides);
  const count = settled ? slides.length : 1;
  const src = current === undefined ? null : photoUrl(restaurant, source, current);
  const shown = photoState(src).status === 'ok' ? (current ?? null) : null;
  useEffect(() => {
    onIndexChange?.(shown);
  }, [shown, onIndexChange]);
  const label = count > 1 ? `${alt}, תמונה ${slot + 1} מתוך ${count}` : alt;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Photo src={src} cuisine={cuisine} alt={label} className="absolute inset-0" />
      <PhotoBars count={count} index={slot} />
      {count > 1 && (
        <div className="absolute inset-0 z-10 flex" dir="rtl">
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה קודמת" disabled={slot === 0} onClick={() => step(-1)} />
          <button type="button" className="h-full w-1/2 cursor-pointer border-0 bg-transparent p-0" aria-label="תמונה הבאה" disabled={slot === count - 1} onClick={() => step(1)} />
        </div>
      )}
    </div>
  );
}

/** A small, non-paging photo (lists, thumbnails): the card's first available slide. */
export function PrimaryPhoto({
  restaurant,
  source,
  cuisine,
  alt,
  className = '',
}: {
  restaurant: PhotoPlace;
  source: RestaurantData['source'];
  cuisine: CuisineKey;
  alt: string;
  className?: string;
}) {
  const { slides } = useCardSlides(restaurant, source, false, 1);
  return <Photo src={photoUrl(restaurant, source, slides[0] ?? 0)} cuisine={cuisine} alt={alt} className={className} priority={1} />;
}
