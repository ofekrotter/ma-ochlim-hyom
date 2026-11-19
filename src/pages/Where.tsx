import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar } from '../components/Screen';
import { IconPin } from '../components/Icons';
import { track } from '../lib/analytics';
import { AREAS, DEFAULT_AREA } from '../lib/areas';
import { RADIUS_MAX, RADIUS_MIN } from '../lib/config';
import { filterBase } from '../lib/data';
import { fmtCount } from '../lib/format';
import { formatDistance, getPosition } from '../lib/geo';
import { useNow } from '../lib/useNow';
import { useRestaurants } from '../state/data';
import { useFlow } from '../state/flow';

const PRICES: { v: 1 | 2 | 3; label: string; hint: string }[] = [
  { v: 1, label: '₪', hint: 'זול' },
  { v: 2, label: '₪₪', hint: 'בינוני' },
  { v: 3, label: '₪₪₪', hint: 'יקר' },
];

export default function Where() {
  const nav = useNavigate();
  const { settings, update } = useFlow();
  const { data, error, retry } = useRestaurants();
  const now = useNow();
  const [geo, setGeo] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');

  useEffect(() => {
    if (!settings.location) update({ location: { lat: DEFAULT_AREA.lat, lng: DEFAULT_AREA.lng, label: DEFAULT_AREA.label, source: 'area', areaId: DEFAULT_AREA.id } });
  }, [settings.location, update]);

  const openCount = useMemo(() => (data ? filterBase(data.restaurants, settings, { now }).length : null), [data, settings, now]);
  const anyCount = useMemo(() => (data ? filterBase(data.restaurants, settings, { now, ignoreHours: true }).length : null), [data, settings, now]);
  const allClosed = openCount === 0 && (anyCount ?? 0) > 0;

  async function useGps() {
    setGeo('loading');
    const r = await getPosition();
    if (r.ok) {
      update({ location: { lat: r.lat, lng: r.lng, label: 'המיקום שלי', source: 'gps' } });
      setGeo('idle');
    } else setGeo(r.reason === 'denied' ? 'denied' : 'error');
  }

  function togglePrice(v: 1 | 2 | 3) {
    const prices = settings.prices.includes(v) ? settings.prices.filter((p) => p !== v) : [...settings.prices, v].sort();
    update({ prices });
    track('price_selected', { prices: prices.join(',') || 'all' });
  }

  function next() {
    track('location_set', { source: settings.location?.source ?? 'area', area: settings.location?.areaId ?? 'gps', radius: settings.radius });
    update({ cuisines: [] });
    nav('/cuisine');
  }

  const groups = [...new Set(AREAS.map((a) => a.group))];
  const isGps = settings.location?.source === 'gps';

  return (
    <Screen>
      <TopBar step={2} back="/start" />
      <h1 className="mt-6 text-3xl font-extrabold">איפה אוכלים?</h1>

      <section className="mt-5 flex flex-col gap-3">
        <button onClick={useGps} disabled={geo === 'loading'} className={`btn w-full justify-between px-5 py-4 text-start ${isGps ? 'bg-charcoal text-white' : 'bg-white shadow-sm'}`}>
          <span className="flex items-center gap-3">
            <IconPin size={22} className={isGps ? 'text-mustard' : 'text-tomato'} />
            {geo === 'loading' ? 'מאתרים אותך…' : isGps ? 'משתמשים במיקום שלך' : 'השתמשו במיקום שלי'}
          </span>
          {isGps && <span aria-hidden>✓</span>}
        </button>

        {geo === 'denied' && (
          <p role="alert" className="rounded-2xl bg-tomato-soft px-4 py-3 text-sm text-tomato-dark">
            לא קיבלנו גישה למיקום. אין בעיה — בחרו אזור מהרשימה 👇
          </p>
        )}
        {geo === 'error' && (
          <p role="alert" className="rounded-2xl bg-tomato-soft px-4 py-3 text-sm text-tomato-dark">
            לא הצלחנו לאתר את המיקום כרגע. בחרו אזור מהרשימה 👇
          </p>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-soft">או בחרו אזור</span>
          <select
            className={`w-full appearance-none rounded-2xl border bg-white px-4 py-3.5 text-base ${geo === 'denied' ? 'border-tomato ring-2 ring-tomato/30' : 'border-charcoal/10'}`}
            value={isGps ? '' : settings.location?.areaId ?? DEFAULT_AREA.id}
            onChange={(e) => {
              const a = AREAS.find((x) => x.id === e.target.value);
              if (a) update({ location: { lat: a.lat, lng: a.lng, label: a.label, source: 'area', areaId: a.id } });
            }}
          >
            {isGps && <option value="">📍 המיקום שלי</option>}
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {AREAS.filter((a) => a.group === g).map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </section>

      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <label htmlFor="radius" className="font-bold">מרחק</label>
          <span className="font-semibold text-tomato">עד {formatDistance(settings.radius)}</span>
        </div>
        <input
          id="radius"
          type="range"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={250}
          value={settings.radius}
          onChange={(e) => update({ radius: Number(e.target.value) })}
          className="mt-3 w-full"
          aria-valuetext={`עד ${formatDistance(settings.radius)}`}
        />
        <div className="flex justify-between text-xs text-ink-soft">
          <span>500 מ׳</span>
          <span>5 ק״מ</span>
        </div>
      </section>

      <section className="mt-7">
        <div className="font-bold">מחיר</div>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="רמת מחיר">
          {PRICES.map((p) => {
            const on = settings.prices.includes(p.v);
            return (
              <button key={p.v} onClick={() => togglePrice(p.v)} aria-pressed={on} className={`${on ? 'chip-on' : 'chip-off'} flex-col justify-center !gap-0 !py-2.5`}>
                <span className="text-lg font-bold tracking-wider">{p.label}</span>
                <span className={`text-xs ${on ? 'text-white/75' : 'text-ink-soft'}`}>{p.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-soft">{settings.prices.length === 0 ? 'לא נבחר מחיר = כל המחירים. ' : ''}מקומות בלי מידע על מחיר תמיד נכללים.</p>
      </section>

      <div className="mt-auto pt-6">
        {error ? (
          <div role="alert" className="mb-3 rounded-2xl bg-tomato-soft p-4 text-center text-sm text-tomato-dark">
            לא הצלחנו לטעון את רשימת המסעדות. בדקו את החיבור לאינטרנט.
            <button className="btn-ghost mx-auto mt-1 !text-tomato-dark underline" onClick={retry}>נסו שוב</button>
          </div>
        ) : allClosed ? (
          <p role="status" className="mb-3 rounded-2xl bg-mustard/20 p-4 text-center text-sm">
            🌙 כל המסעדות בטווח סגורות עכשיו. נסו שוב יותר מאוחר, או הגדילו את המרחק.
            <span className="mt-1 block text-xs">מקום בלי שעות פעילות ידועות כן נשאר ברשימה.</span>
          </p>
        ) : openCount === 0 ? (
          <p role="status" className="mb-3 rounded-2xl bg-mustard/20 p-4 text-center text-sm">
            😕 אין מסעדות שמתאימות לחיפוש. נסו להגדיל את המרחק, לבטל את סינון המחיר או לבחור אזור אחר.
          </p>
        ) : null}
        {openCount !== null && anyCount !== null && anyCount > openCount && openCount > 0 && (
          <p className="mb-3 text-center text-xs text-ink-soft">{fmtCount(openCount)} פתוחות עכשיו מתוך {fmtCount(anyCount)} בטווח · שעון ישראל</p>
        )}
        <button className="btn-primary w-full" disabled={!openCount} onClick={next}>
          {openCount === null && !error ? 'טוענים מסעדות…' : openCount ? `המשך · ${fmtCount(openCount)} מסעדות` : 'המשך'}
        </button>
      </div>
    </Screen>
  );
}
