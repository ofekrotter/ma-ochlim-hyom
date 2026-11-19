import { useState } from 'react';
import { CUISINES } from '../lib/cuisines';
import type { CuisineKey } from '../lib/types';

/** Restaurant photo with a cuisine illustration fallback (no photo / failed load / no backend yet). */
export function Photo({ src, cuisine, alt, className = '', eager = false }: { src: string | null; cuisine: CuisineKey; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const c = CUISINES[cuisine] ?? CUISINES.other;
  const showImg = src && !failed;
  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden ${className}`} style={{ background: `linear-gradient(140deg, ${c.from}, ${c.to})` }}>
      {(!showImg || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="text-[min(34vw,140px)] drop-shadow-[0_8px_16px_rgb(0_0_0/0.18)]">{c.emoji}</span>
        </div>
      )}
      {showImg && (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
