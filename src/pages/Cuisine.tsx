import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Screen, TopBar } from '../components/Screen';
import { track } from '../lib/analytics';
import { backend } from '../lib/backend';
import { CUISINE_ORDER, CUISINES } from '../lib/cuisines';
import { buildDeck, cuisineCounts, filterBase, filterCuisine } from '../lib/data';
import { fmtCount } from '../lib/format';
import { useNow } from '../lib/useNow';
import type { CuisineKey } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFlow } from '../state/flow';
import { markCreator } from '../state/friend';
import { newSoloRun } from '../state/solo';

export default function Cuisine() {
  const nav = useNavigate();
  const { settings, update } = useFlow();
  const { data } = useRestaurants();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const base = useMemo(() => (data ? filterBase(data.restaurants, settings, { now }) : []), [data, settings, now]);
  const counts = useMemo(() => cuisineCounts(base), [base]);
  const available = CUISINE_ORDER.filter((c) => counts.has(c));
  const matching = filterCuisine(base, settings.cuisines).length;

  function toggle(c: CuisineKey | 'all') {
    const cuisines = c === 'all' ? [] : settings.cuisines.includes(c) ? settings.cuisines.filter((x) => x !== c) : [...settings.cuisines, c];
    update({ cuisines });
    track('cuisine_selected', { cuisines: cuisines.join(',') || 'all' });
  }

  async function start() {
    if (!data) return;
    if (settings.mode === 'solo') {
      newSoloRun();
      nav('/swipe');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const session = await backend.createSession(settings, (code) => buildDeck(data.restaurants, settings, `${code}:1`, now).map((r) => r.id));
      markCreator(session.code);
      track('session_created', { cards: session.deck.length });
      nav(`/s/${session.code}`);
    } catch {
      setErr('לא הצלחנו ליצור חדר כרגע. בדקו את החיבור ונסו שוב.');
      setBusy(false);
    }
  }

  if (data && base.length === 0) return <Navigate to="/where" replace />;

  return (
    <Screen>
      <TopBar step={3} back="/where" />
      <h1 className="mt-6 text-3xl font-extrabold">מה בא לכם?</h1>
      <p className="mt-1 text-ink-soft">רק סוגי אוכל של מקומות פתוחים עכשיו באזור שבחרתם</p>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="סוג מטבח">
        <button className={settings.cuisines.length === 0 ? 'chip-on' : 'chip-off'} aria-pressed={settings.cuisines.length === 0} onClick={() => toggle('all')}>
          ✨ הכל <span className="opacity-60">{fmtCount(base.length)}</span>
        </button>
        {available.map((c) => {
          const on = settings.cuisines.includes(c);
          return (
            <button key={c} className={on ? 'chip-on' : 'chip-off'} aria-pressed={on} onClick={() => toggle(c)}>
              <span aria-hidden>{CUISINES[c].emoji}</span> {CUISINES[c].label} <span className="opacity-60">{fmtCount(counts.get(c) ?? 0)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto pt-6">
        <p className="mb-3 text-center text-ink-soft" aria-live="polite">
          <b className="text-2xl text-charcoal">{fmtCount(matching)}</b> מסעדות מחכות לכם
        </p>
        {err && <p role="alert" className="mb-3 rounded-2xl bg-tomato-soft p-3 text-center text-sm text-tomato-dark">{err}</p>}
        <button className="btn-primary w-full" disabled={!data || matching === 0 || busy} onClick={start}>
          {busy ? 'יוצרים חדר…' : settings.mode === 'solo' ? 'מתחילים להחליק 👆' : 'יוצרים חדר ומזמינים חבר 👯'}
        </button>
      </div>
    </Screen>
  );
}
