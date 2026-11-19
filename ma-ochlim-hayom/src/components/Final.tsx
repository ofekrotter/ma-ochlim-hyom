import { photoUrl } from '../lib/data';
import type { Restaurant, RestaurantData } from '../lib/types';
import { NavButtons, ShareButton } from './Actions';
import { PhotoCredit, Rating, Tags } from './Meta';
import { Photo } from './Photo';

/** Final restaurant card: photo, name, rating, address, navigate + share. */
export function FinalCard({ r, source, context, shareText }: { r: Restaurant & { distance?: number }; source: RestaurantData['source']; context: string; shareText: string }) {
  return (
    <div className="card overflow-hidden anim-pop">
      <Photo src={photoUrl(r, source)} cuisine={r.cuisine} alt={r.name} className="aspect-[4/3] w-full" eager />
      <div className="p-5">
        <h2 className="text-2xl font-bold leading-tight">{r.name}</h2>
        <div className="mt-1.5"><Rating r={r} /></div>
        {r.address && <p className="mt-1.5 text-[15px] text-ink-soft">📍 {r.address}</p>}
        <div className="mt-3"><Tags r={r} /></div>
        <div className="mt-5"><NavButtons r={r} context={context} /></div>
        <div className="mt-3">
          <ShareButton title="מה אוכלים היום" text={shareText} url={window.location.origin} context={context} />
        </div>
        <div className="mt-3"><PhotoCredit r={r} /></div>
      </div>
    </div>
  );
}
