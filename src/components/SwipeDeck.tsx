import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { photoUrl } from '../lib/data';
import { photoCountOf, photoCreditOf, primaryPhotoIndex } from '../lib/photos';
import { photoState, requestPhoto } from '../lib/photoLoader';
import { enqueueSwipe, photoTapDirection } from '../lib/swipeQueue';
import type { DeckCard, RestaurantData } from '../lib/types';
import { IconHeart, IconUndo, IconX } from './Icons';
import { PhotoCredit, Rating, Tags } from './Meta';
import { Photo, PhotoBars, useCardSlides, useSlidePosition } from './Photo';

export type Dir = 'left' | 'right';
export interface SwipeDeckHandle {
  swipe: (dir: Dir) => void;
}
interface TopCardHandle extends SwipeDeckHandle {
  busy: () => boolean;
}

interface Props {
  cards: DeckCard[];
  index: number;
  source: RestaurantData['source'];
  onSwipe: (dir: Dir, card: DeckCard) => void;
  /** Card that just came back via undo — animates in from the side it left. */
  returning?: { id: string; dir: Dir } | null;
}

const THRESHOLD = 110;
const VELOCITY = 650;
export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(function SwipeDeck({ cards, index, source, onSwipe, returning }, ref) {
  const topRef = useRef<TopCardHandle>(null);
  const queue = useRef<Dir[]>([]);
  const remaining = cards.length - index;

  const swipe = useCallback(
    (d: Dir) => {
      const top = topRef.current;
      if (!top) return;
      if (top.busy() || queue.current.length > 0) {
        // The card in flight counts as one of the remaining cards.
        queue.current = enqueueSwipe(queue.current, d, remaining - 1);
        return;
      }
      top.swipe(d);
    },
    [remaining],
  );
  useImperativeHandle(ref, () => ({ swipe }), [swipe]);

  // A new top card is up: play the next queued swipe, if any.
  const topId = cards[index]?.id;
  useEffect(() => {
    if (!topId) {
      queue.current = [];
      return;
    }
    if (queue.current.length === 0) return;
    const t = setTimeout(() => {
      const next = queue.current.shift();
      if (next) topRef.current?.swipe(next);
    }, 0);
    return () => clearTimeout(t);
  }, [topId]);

  // Preload the photo the next cards open on, so they show right away.
  useEffect(() => {
    for (const c of cards.slice(index + 1, index + 4)) {
      const src = photoUrl(c, source, primaryPhotoIndex(c));
      if (src) requestPhoto(src, 2);
    }
  }, [cards, index, source]);

  const visible = cards.slice(index, index + 3);
  return (
    <div className="relative mx-auto w-full flex-1" style={{ minHeight: 380 }} aria-live="polite">
      {visible
        .map((card, i) =>
          i === 0 ? (
            <TopCard key={card.id} ref={topRef} card={card} source={source} onSwipe={onSwipe} returning={returning?.id === card.id ? returning.dir : null} hurry={() => queue.current.length > 0} />
          ) : (
            <motion.div
              key={card.id}
              className="absolute inset-0"
              initial={false}
              animate={{ scale: 1 - i * 0.045, y: i * 14 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{ zIndex: 10 - i }}
              aria-hidden
            >
              <CardFace card={card} source={source} priority={2} />
            </motion.div>
          ),
        )
        .reverse()}
    </div>
  );
});

const TopCard = forwardRef<
  TopCardHandle,
  { card: DeckCard; source: RestaurantData['source']; onSwipe: Props['onSwipe']; returning: Dir | null; hurry: () => boolean }
>(function TopCard({ card, source, onSwipe, returning, hurry }, ref) {
  const reduce = useReducedMotion();
  // The open card asks for all of its photos (cached extras only) so the dots are known up front.
  const { slides, settled } = useCardSlides(card, source, true, 0);
  const { slot, current, step } = useSlidePosition(slides);
  const count = settled ? slides.length : 1;
  const elRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(returning ? (returning === 'right' ? 500 : -500) : 0);
  const opacity = useMotionValue(1);
  const rotate = useTransform(x, [-320, 320], reduce ? [0, 0] : [-14, 14]);
  const likeOpacity = useTransform(x, [25, THRESHOLD], [0, 1]);
  const skipOpacity = useTransform(x, [-THRESHOLD, -25], [1, 0]);
  const leaving = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (returning) animate(x, 0, { type: 'spring', stiffness: 380, damping: 32 });
  }, [returning, x]);

  function fly(dir: Dir) {
    if (leaving.current) return;
    leaving.current = true;
    if (reduce) {
      x.set(dir === 'right' ? 60 : -60);
      animate(opacity, 0, { duration: 0.12 }).then(() => onSwipe(dir, card));
      return;
    }
    const w = Math.max(window.innerWidth, 400);
    // Shorter flight while more swipes are waiting, so a burst of keys keeps up.
    const duration = hurry() ? 0.16 : 0.3;
    animate(x, dir === 'right' ? w * 1.15 : -w * 1.15, { duration, ease: [0.3, 0.6, 0.4, 1] }).then(() => onSwipe(dir, card));
  }

  useImperativeHandle(ref, () => ({ swipe: fly, busy: () => leaving.current }));

  return (
    <motion.div
      ref={elRef}
      className="absolute inset-0 z-20 cursor-grab touch-none active:cursor-grabbing"
      style={{ x, rotate, opacity }}
      drag="x"
      dragMomentum={false}
      dragElastic={1}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (!start || leaving.current || count < 2) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        // Anything past a tap is a swipe (or a failed swipe that snaps back). Photo paging
        // stays far below THRESHOLD so it cannot like or skip the card.
        if (Math.abs(dx) > 16 || Math.abs(dy) > 16) return;
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('a, button')) return;
        const rect = elRef.current?.getBoundingClientRect();
        if (!rect) return;
        // RTL, like the dots: the left half moves forward, the right half goes back.
        step(photoTapDirection(e.clientX, rect.left, rect.width));
      }}
      onDragEnd={(_, info) => {
        const off = info.offset.x;
        const v = info.velocity.x;
        if (off > THRESHOLD || v > VELOCITY) fly('right');
        else if (off < -THRESHOLD || v < -VELOCITY) fly('left');
        else animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 });
      }}
      role="group"
      aria-roledescription="כרטיס מסעדה"
      aria-label={count > 1 ? `${card.name}, תמונה ${slot + 1} מתוך ${count}` : card.name}
    >
      <CardFace card={card} source={source} photoIndex={current} photoSlot={slot} photoCount={count} />
      <motion.div style={{ opacity: likeOpacity }} className="pointer-events-none absolute left-5 top-12 z-30 -rotate-12 rounded-xl border-4 border-basil bg-white/85 px-3 py-1 text-3xl font-extrabold text-basil" aria-hidden>
        אהבתי
      </motion.div>
      <motion.div style={{ opacity: skipOpacity }} className="pointer-events-none absolute right-5 top-12 z-30 rotate-12 rounded-xl border-4 border-tomato bg-white/85 px-3 py-1 text-3xl font-extrabold text-tomato" aria-hidden>
        דלג
      </motion.div>
    </motion.div>
  );
});

/**
 * One restaurant card. Without `photoIndex` it shows the photo the card opens on
 * (with fallback). `overlay` sits above the photo and below the photo credit, for
 * a full-card button that must not wrap the credit link.
 */
export function CardFace({
  card,
  source,
  photoIndex,
  photoSlot = 0,
  photoCount,
  priority = 0,
  overlay,
}: {
  card: DeckCard;
  source: RestaurantData['source'];
  /** Kept for callers. */
  eager?: boolean;
  photoIndex?: number;
  photoSlot?: number;
  photoCount?: number;
  priority?: 0 | 1 | 2;
  overlay?: ReactNode;
}) {
  const own = useCardSlides(card, source, false, priority);
  const index = photoIndex ?? own.slides[0] ?? 0;
  const count = photoCount ?? 1;
  const src = photoUrl(card, source, index);
  // The author credit is about the photo: show it only while that photo is on screen.
  const photoShown = photoCountOf(card) > 0 && photoState(src).status === 'ok';
  const alt = count > 1 ? `${card.name}, תמונה ${photoSlot + 1} מתוך ${count}` : card.name;
  return (
    <article className="card relative h-full w-full select-none overflow-hidden">
      <Photo src={src} cuisine={card.cuisine} alt={alt} className="absolute inset-0" priority={priority} />
      <PhotoBars count={count} index={photoSlot} />
      {overlay}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-4 pt-24 text-white">
        <h2 className="text-[1.7rem] font-bold leading-tight drop-shadow">{card.name}</h2>
        <div className="mt-1.5 text-[15px]">
          <Rating r={card} light />
        </div>
        <div className="mt-2.5">
          <Tags r={card} light />
        </div>
        <div className="pointer-events-auto relative z-20 mt-2.5 w-fit">
          <PhotoCredit r={card} credit={photoShown ? photoCreditOf(card, index) : null} light />
        </div>
      </div>
    </article>
  );
}

export function SwipeButtons({ onSkip, onLike, onUndo, canUndo, disabled }: { onSkip: () => void; onLike: () => void; onUndo: () => void; canUndo: boolean; disabled?: boolean }) {
  return (
    <div dir="ltr" className="flex items-center justify-center gap-5 pt-4">
      <button onClick={onSkip} disabled={disabled} className="btn h-16 w-16 bg-white text-tomato shadow-[var(--shadow-card)]" aria-label="דלג">
        <IconX size={30} />
      </button>
      <button onClick={onUndo} disabled={!canUndo || disabled} className="btn h-12 w-12 bg-white text-mustard shadow-md" aria-label="בטל החלקה אחרונה">
        <IconUndo size={22} />
      </button>
      <button onClick={onLike} disabled={disabled} className="btn h-16 w-16 bg-tomato text-white shadow-[0_14px_30px_-12px_rgb(217_58_43/0.8)]" aria-label="אהבתי">
        <IconHeart size={30} />
      </button>
    </div>
  );
}

/** Arrow keys for desktop users. */
export function useSwipeKeys(enabled: boolean, onDir: (d: Dir) => void, onUndo?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.defaultPrevented || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      // Held-down keys auto-repeat; only real presses count. Each press is queued like a button tap.
      if (e.repeat && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;
      if (e.key === 'ArrowRight') onDir('right');
      else if (e.key === 'ArrowLeft') onDir('left');
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') onUndo?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled, onDir, onUndo]);
}
