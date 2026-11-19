import { useState } from 'react';
import { track } from '../lib/analytics';
import { mapsLinks } from '../lib/data';
import { woltSearchUrl } from '../lib/wolt';
import type { Restaurant } from '../lib/types';
import { IconBag, IconNav, IconShare } from './Icons';

export function NavButtons({ r, context }: { r: Restaurant; context: string }) {
  const links = mapsLinks(r);
  const wolt = woltSearchUrl(r);
  return (
    <div className="grid grid-cols-2 gap-3">
      <a className="btn-primary !px-4 !text-base" href={links.google} target="_blank" rel="noopener noreferrer" onClick={() => track('navigate_clicked', { app: 'google_maps', context })}>
        <IconNav size={20} /> נווט ב-Maps
      </a>
      <a className="btn bg-[#33ccff] px-4 py-4 text-base text-charcoal shadow-[0_10px_24px_-12px_rgb(51_204_255/0.9)]" href={links.waze} target="_blank" rel="noopener noreferrer" onClick={() => track('navigate_clicked', { app: 'waze', context })}>
        <IconNav size={20} /> נווט ב-Waze
      </a>
      <a
        className="btn col-span-2 bg-[#009DE0] px-4 py-4 text-base text-white shadow-[0_10px_24px_-12px_rgb(0_157_224/0.9)]"
        href={wolt}
        target="_blank"
        rel="noopener noreferrer"
        title="נפתח חיפוש ב-Wolt. לא כל מסעדה רשומה שם."
        onClick={() => track('navigate_clicked', { app: 'wolt', context })}
      >
        <IconBag size={20} /> הזמינו ב-Wolt
      </a>
    </div>
  );
}

export function ShareButton({ title, text, url, context, className = 'btn-secondary w-full' }: { title: string; text: string; url: string; context: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    track('share_clicked', { context, method: 'native' in navigator ? 'native' : 'copy' });
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
    }
  }
  return (
    <button className={className} onClick={share}>
      <IconShare size={20} /> {copied ? 'הקישור הועתק ✓' : 'שתף'}
    </button>
  );
}
