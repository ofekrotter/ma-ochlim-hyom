import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { FinalCard } from '../components/Final';
import { CardFace } from '../components/SwipeDeck';
import { Screen, TopBar } from '../components/Screen';
import { celebrate } from '../components/confetti';
import { track } from '../lib/analytics';
import { RADIUS_MAX } from '../lib/config';
import { deckFromIds } from '../lib/data';
import { isOpenAt } from '../lib/hours';
import type { DeckCard } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFlow } from '../state/flow';
import { newSoloRun, useSoloRun } from '../state/solo';
import { Loading } from './shared';

export default function Result() {
  const nav = useNavigate();
  const { settings, update } = useFlow();
  const { data } = useRestaurants();
  const [run] = useSoloRun();
  const now = useMemo(() => new Date(), [data, run.likes]);
  const likedAll = useMemo(() => (data ? deckFromIds(data.restaurants, run.likes, settings) : []), [data, run.likes, settings]);
  const liked = useMemo(() => likedAll.filter((r) => isOpenAt(r.hours, now)), [likedAll, now]);

  // Head-to-head: champion vs. next challenger until one remains.
  const [champ, setChamp] = useState(0);
  const [next, setNext] = useState(1);
  const winner: DeckCard | null = liked.length === 1 ? liked[0] : liked.length > 1 && next >= liked.length ? liked[champ] : null;

  useEffect(() => {
    if (winner) {
      celebrate();
      track('solo_result', { liked: liked.length, cuisine: winner.cuisine });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner?.id]);

  function restart() {
    newSoloRun();
    nav('/swipe');
  }
  function widen() {
    update({ radius: Math.min(RADIUS_MAX, settings.radius + 1500), prices: [] });
    newSoloRun();
    nav('/where');
  }

  if (!data) return <Loading />;

  if (liked.length === 0) {
    const closed = likedAll.length > 0;
    return (
      <Screen>
        <TopBar back="/swipe" />
        {closed ? (
          <EmptyState emoji="🌙" title="המקומות שאהבתם כבר סגורים" text="נציג רק מסעדות פתוחות עכשיו. אפשר להתחיל סיבוב חדש, או להרחיב את החיפוש.">
            <button className="btn-primary" onClick={widen}>הרחיבו את החיפוש</button>
            <button className="btn-secondary" onClick={restart}>מתחילים מחדש</button>
          </EmptyState>
        ) : (
          <EmptyState emoji="🤷" title="שום דבר לא עשה לכם את זה?" text="קורה. אפשר להרחיב את החיפוש או לעבור שוב על הרשימה בסדר אחר.">
            <button className="btn-primary" onClick={widen}>הרחיבו את החיפוש</button>
            <button className="btn-secondary" onClick={restart}>מתחילים מחדש</button>
          </EmptyState>
        )}
      </Screen>
    );
  }

  if (!winner) {
    const a = liked[champ];
    const b = liked[next];
    const rounds = liked.length - 1;
    const choose = (keepA: boolean) => {
      if (!keepA) setChamp(next);
      setNext((n) => n + 1);
    };
    return (
      <Screen>
        <TopBar back="/swipe" />
        <div className="mt-2 text-center">
          <h1 className="text-3xl font-extrabold">מי מנצח? 🥊</h1>
          <p className="mt-1 text-ink-soft">אהבתם {liked.length} מקומות. סיבוב {next} מתוך {rounds}</p>
        </div>
        <div className="mt-5 grid flex-1 grid-rows-2 gap-3">
          {[a, b].map((r, i) => (
            <button key={r.id} onClick={() => choose(i === 0)} className="relative min-h-[200px] rounded-[var(--radius-card)] text-start transition active:scale-[0.98] anim-pop" aria-label={`בוחרים ב${r.name}`}>
              <div className="absolute inset-0"><CardFace card={r} source={data.source} eager /></div>
            </button>
          ))}
        </div>
        <p className="py-3 text-center text-sm text-ink-soft">הקישו על המקום שמתחשק לכם יותר</p>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar back="/swipe" />
      <h1 className="mb-4 mt-2 text-center text-3xl font-extrabold">הולכים לאכול ב… 🎉</h1>
      <FinalCard r={winner} source={data.source} context="solo" shareText={`החלטתי! אוכלים היום ב${winner.name} 😋 גם אתם מתלבטים? נסו את "מה אוכלים היום":`} />
      <button className="btn-ghost mx-auto mt-4" onClick={restart}>מתחילים מחדש</button>
    </Screen>
  );
}
