import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { photoUrl } from '../lib/data';
import type { DeckCard, RestaurantData } from '../lib/types';
import { IconHeart, IconUndo, IconX } from './Icons';
import { PhotoCredit, Rating, Tags } from './Meta';
import { Photo } from './Photo';

export type Dir = 'left' | 'right';
export interface SwipeDeckHandle {
  swipe: (dir: Dir) => void;
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
  const topRef = useRef<SwipeDeckHandle>(null);
  useImperativeHandle(ref, () => ({ swipe: (d) => topRef.current?.swipe(d) }), []);

  // Preload the next photos so the next card is instant.
  useEffect(() => {
    for (const c of cards.slice(index + 1, index + 4)) {
      const src = photoUrl(c, source);
      if (src) {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
      }
    }
  }, [cards, index, source]);

  const visible = cards.slice(index, index + 3);
  return (
    <div className="relative mx-auto w-full flex-1" style={{ minHeight: 380 }} aria-live="polite">
      {visible
        .map((card, i) =>
          i === 0 ? (
            <TopCard key={card.id} ref={topRef} card={card} source={source} onSwipe={onSwipe} returning={returning?.id === card.id ? returning.dir : null} />
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
              <CardFace card={card} source={source} />
            </motion.div>
          ),
        )
        .reverse()}
    </div>
  );
});

const TopCard = forwardRef<SwipeDeckHandle, { card: DeckCard; source: RestaurantData['source']; onSwipe: Props['onSwipe']; returning: Dir | null }>(function TopCard(
  { card, source, onSwipe, returning },
  ref,
) {
  const reduce = useReducedMotion();
  const x = useMotionValue(returning ? (returning === 'right' ? 500 : -500) : 0);
  const opacity = useMotionValue(1);
  const rotate = useTransform(x, [-320, 320], reduce ? [0, 0] : [-14, 14]);
  const likeOpacity = useTransform(x, [25, THRESHOLD], [0, 1]);
  const skipOpacity = useTransform(x, [-THRESHOLD, -25], [1, 0]);
  const leaving = useRef(false);

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
    animate(x, dir === 'right' ? w * 1.15 : -w * 1.15, { duration: 0.3, ease: [0.3, 0.6, 0.4, 1] }).then(() => onSwipe(dir, card));
  }

  useImperativeHandle(ref, () => ({ swipe: fly }));

  return (
    <motion.div
      className="absolute inset-0 z-20 cursor-grab touch-none active:cursor-grabbing"
      style={{ x, rotate, opacity }}
      drag="x"
      dragMomentum={false}
      dragElastic={1}
      onDragEnd={(_, info) => {
        const off = info.offset.x;
        const v = info.velocity.x;
        if (off > THRESHOLD || v > VELOCITY) fly('right');
        else if (off < -THRESHOLD || v < -VELOCITY) fly('left');
        else animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 });
      }}
      role="group"
      aria-roledescription="כרטיס מסעדה"
      aria-label={card.name}
    >
      <CardFace card={card} source={source} eager />
      <motion.div style={{ opacity: likeOpacity }} className="pointer-events-none absolute left-5 top-6 -rotate-12 rounded-xl border-4 border-basil bg-white/85 px-3 py-1 text-3xl font-extrabold text-basil" aria-hidden>
        אהבתי
      </motion.div>
      <motion.div style={{ opacity: skipOpacity }} className="pointer-events-none absolute right-5 top-6 rotate-12 rounded-xl border-4 border-tomato bg-white/85 px-3 py-1 text-3xl font-extrabold text-tomato" aria-hidden>
        דלג
      </motion.div>
    </motion.div>
  );
});

export function CardFace({ card, source, eager = false }: { card: DeckCard; source: RestaurantData['source']; eager?: boolean }) {
  return (
    <article className="card relative h-full w-full select-none overflow-hidden">
      <Photo src={photoUrl(card, source)} cuisine={card.cuisine} alt={card.name} className="absolute inset-0" eager={eager} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-4 pt-24 text-white">
        <h2 className="text-[1.7rem] font-bold leading-tight drop-shadow">{card.name}</h2>
        <div className="mt-1.5 text-[15px]">
          <Rating r={card} light />
        </div>
        <div className="mt-2.5">
          <Tags r={card} light />
        </div>
        <div className="mt-2.5">
          <PhotoCredit r={card} light />
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
      if (e.key === 'ArrowRight') onDir('right');
      else if (e.key === 'ArrowLeft') onDir('left');
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') onUndo?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled, onDir, onUndo]);
}
