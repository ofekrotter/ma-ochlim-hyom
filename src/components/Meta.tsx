import { CUISINES } from '../lib/cuisines';
import { fmtCount, fmtRating, priceLabel } from '../lib/format';
import { formatDistance } from '../lib/geo';
import type { DeckCard, Restaurant } from '../lib/types';
import { IconStar } from './Icons';

export function Rating({ r, light = false }: { r: Pick<Restaurant, 'rating' | 'ratings'>; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`דירוג ${fmtRating(r.rating)} מתוך 5, ${fmtCount(r.ratings)} דירוגים`}>
      <IconStar size={18} className="text-mustard" />
      <b className="font-semibold">{fmtRating(r.rating)}</b>
      <span className={light ? 'text-white/75' : 'text-ink-soft'}>({fmtCount(r.ratings)})</span>
    </span>
  );
}

export function Tags({ r, light = false }: { r: DeckCard | (Restaurant & { distance?: number }); light?: boolean }) {
  const c = CUISINES[r.cuisine] ?? CUISINES.other;
  const pill = light ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-cream-dark text-charcoal';
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className={`rounded-full px-2.5 py-1 font-medium ${pill}`}>{c.emoji} {c.label}</span>
      {r.price && <span className={`rounded-full px-2.5 py-1 font-semibold tracking-wider ${pill}`} aria-label={`רמת מחיר ${r.price} מתוך 3`}>{priceLabel(r.price)}</span>}
      {typeof r.distance === 'number' && r.distance > 0 && <span className={`rounded-full px-2.5 py-1 ${pill}`}>📍 {formatDistance(r.distance)}</span>}
    </div>
  );
}

export function PhotoCredit({ r, light = false, credit }: { r: Restaurant; light?: boolean; credit?: { name: string; uri: string } }) {
  const name = credit?.name ?? r.photoAuthor ?? '';
  const uri = credit?.uri ?? r.photoAuthorUri ?? '';
  return (
    <p className={`text-[10px] leading-tight ${light ? 'text-white/70' : 'text-ink-soft'}`}>
      {name ? (
        <>
          תמונה:{' '}
          {uri ? (
            <a href={uri} target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              {name}
            </a>
          ) : (
            name
          )}{' '}
          ·{' '}
        </>
      ) : null}
      <span translate="no">Google Maps</span>
    </p>
  );
}
