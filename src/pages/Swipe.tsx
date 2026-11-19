import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Screen, TopBar } from '../components/Screen';
import { SwipeButtons, SwipeDeck, useSwipeKeys, type Dir, type SwipeDeckHandle } from '../components/SwipeDeck';
import { track, trackOnce } from '../lib/analytics';
import { buildDeck, filterBase, filterCuisine } from '../lib/data';
import type { DeckCard } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFlow } from '../state/flow';
import { useSoloRun } from '../state/solo';
import { DemoBadge, Loading } from './shared';

export default function Swipe() {
  const nav = useNavigate();
  const { settings } = useFlow();
  const { data, error, retry } = useRestaurants();
  const [run, setRun] = useSoloRun();
  const deckRef = useRef<SwipeDeckHandle>(null);
  const [returning, setReturning] = useState<{ id: string; dir: Dir } | null>(null);

  const at = useMemo(() => (run.at ? new Date(run.at) : new Date()), [run.at]);
  useEffect(() => {
    if (!run.at) setRun((r) => (r.at ? r : { ...r, at: new Date().toISOString() }));
  }, [run.at, setRun]);
  const deck = useMemo(() => (data ? buildDeck(data.restaurants, settings, run.seed, at) : []), [data, settings, run.seed, at]);
  const done = data && deck.length > 0 && run.index >= deck.length;
  const allClosed = Boolean(
    data && deck.length === 0 && filterCuisine(filterBase(data.restaurants, settings, { now: at, ignoreHours: true }), settings.cuisines).length > 0,
  );

  useEffect(() => {
    if (done) {
      setRun((r) => ({ ...r, finished: true }));
      nav('/result', { replace: true });
    }
  }, [done, nav, setRun]);

  const onSwipe = useCallback(
    (dir: Dir, card: DeckCard) => {
      trackOnce('first_swipe', { mode: 'solo' }, 'first_swipe_solo');
      track(dir === 'right' ? 'swipe_like' : 'swipe_skip', { mode: 'solo', cuisine: card.cuisine });
      setReturning(null);
      setRun((r) => ({
        ...r,
        index: r.index + 1,
        likes: dir === 'right' ? [...r.likes.filter((x) => x !== card.id), card.id] : r.likes,
        history: [...r.history, { id: card.id, dir }].slice(-50),
      }));
    },
    [setRun],
  );

  const undo = useCallback(() => {
    const last = run.history[run.history.length - 1];
    if (!last || run.index === 0) return;
    setReturning(last);
    setRun((r) => ({ ...r, index: r.index - 1, likes: r.likes.filter((x) => x !== last.id), history: r.history.slice(0, -1) }));
  }, [run, setRun]);

  const swipeBtn = useCallback((d: Dir) => deckRef.current?.swipe(d), []);
  useSwipeKeys(Boolean(data && !done), swipeBtn, undo);

  if (error) {
    return (
      <Screen>
        <EmptyState emoji="📡" title="אופס, בעיית חיבור" text="לא הצלחנו לטעון את המסעדות.">
          <button className="btn-primary" onClick={retry}>נסו שוב</button>
        </EmptyState>
      </Screen>
    );
  }
  if (!data) return <Loading />;

  if (deck.length === 0) {
    return (
      <Screen>
        <TopBar back="/where" />
        {allClosed ? (
          <EmptyState emoji="🌙" title="הכל סגור עכשיו" text="אין מסעדות פתוחות שמתאימות לחיפוש. נסו שוב כשייפתחו, או שנו את האזור והמרחק.">
            <button className="btn-primary" onClick={() => nav('/where')}>שינוי חיפוש</button>
          </EmptyState>
        ) : (
          <EmptyState emoji="🔍" title="לא מצאנו מסעדות" text="נסו להגדיל את המרחק, להוסיף רמות מחיר או לבחור עוד סוגי אוכל.">
            <button className="btn-primary" onClick={() => nav('/where')}>שינוי חיפוש</button>
          </EmptyState>
        )}
      </Screen>
    );
  }

  const position = Math.min(run.index + 1, deck.length);
  return (
    <Screen className="!pb-4 overflow-hidden">
      <TopBar
        back="/cuisine"
        right={
          <button className="btn whitespace-nowrap rounded-full bg-charcoal px-4 py-2 text-sm text-white" onClick={() => nav('/result')}>
            סיימתי
          </button>
        }
      />
      <div className="mb-3 mt-1 flex items-center justify-between text-sm text-ink-soft">
        <span aria-live="polite">כרטיס {position} מתוך {deck.length}</span>
        <span>❤️ {run.likes.length} אהבתי</span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-charcoal/10">
        <div className="h-full rounded-full bg-tomato transition-all" style={{ width: `${(run.index / deck.length) * 100}%` }} />
      </div>
      {data.source === 'sample' && <DemoBadge />}
      <SwipeDeck ref={deckRef} cards={deck} index={run.index} source={data.source} onSwipe={onSwipe} returning={returning} />
      <SwipeButtons onSkip={() => swipeBtn('left')} onLike={() => swipeBtn('right')} onUndo={undo} canUndo={run.index > 0} />
    </Screen>
  );
}
