import { useEffect, useState } from 'react';
import { Screen } from '../components/Screen';
import { backend, type SeedResult, type StatsResult } from '../lib/backend';
import { fmtCount } from '../lib/format';

const FUNNEL: { key: string; label: string }[] = [
  { key: 'app_open', label: 'כניסות' },
  { key: 'cta_click', label: 'לחצו "יאללה"' },
  { key: 'location_set', label: 'בחרו מיקום' },
  { key: 'first_swipe', label: 'החליקו לפחות פעם אחת' },
  { key: 'match_found', label: 'מאץ׳ (עם חבר)' },
  { key: 'solo_result', label: 'בחרו מסעדה (לבד)' },
];
const OTHER = ['mode_selected_solo', 'mode_selected_friend', 'price_selected', 'cuisine_selected', 'swipe_like', 'swipe_skip', 'session_created', 'friend_joined', 'navigate_clicked', 'share_clicked'];

export default function Stats() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('mo:stats-pw') || '');
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [seed, setSeed] = useState<SeedResult | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex,nofollow';
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  async function load(p = pw) {
    setLoading(true);
    setErr('');
    try {
      const s = await backend.stats(p);
      setStats(s);
      sessionStorage.setItem('mo:stats-pw', p);
    } catch (e) {
      setErr((e as Error).message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (pw) void load(pw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSeed() {
    if (!confirm('לרענן את נתוני המסעדות מ-Google? (כ-90 קריאות API, פעם בחודש מספיק)')) return;
    setSeeding(true);
    setSeed(null);
    try {
      setSeed(await backend.seed(pw));
    } catch (e) {
      setSeed({ error: (e as Error).message });
    } finally {
      setSeeding(false);
      void load();
    }
  }

  if (!stats) {
    return (
      <Screen className="justify-center">
        <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="card p-6">
          <h1 className="text-2xl font-extrabold">📊 סטטיסטיקות</h1>
          <label className="mt-4 block text-sm text-ink-soft" htmlFor="pw">סיסמה</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 w-full rounded-2xl border border-charcoal/15 px-4 py-3" autoComplete="current-password" />
          {err && <p role="alert" className="mt-2 text-sm text-tomato-dark">{err}</p>}
          <button className="btn-primary mt-4 w-full" disabled={!pw || loading}>{loading ? 'טוען…' : 'כניסה'}</button>
        </form>
      </Screen>
    );
  }

  const t = stats.totals;
  const top = Math.max(1, t.app_open ?? 0);
  const days = [...new Set(stats.daily.map((d) => d.day))].slice(0, 14);
  const dayVal = (day: string, ev: string) => stats.daily.find((d) => d.day === day && d.event === ev)?.count ?? 0;

  return (
    <Screen className="max-w-2xl">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-3xl font-extrabold">📊 המשפך של "מה אוכלים היום"</h1>
        <button className="btn-ghost" onClick={() => load()}>רענון</button>
      </div>
      <div className="card mt-5 p-5">
        {FUNNEL.map((f, i) => {
          const v = t[f.key] ?? 0;
          const pct = Math.round((v / top) * 100);
          return (
            <div key={f.key} className="mb-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{i + 1}. {f.label}</span>
                <span><b>{fmtCount(v)}</b> <span className="text-ink-soft">({pct}%)</span></span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-cream-dark">
                <div className="h-full rounded-full bg-tomato" style={{ width: `${Math.max(pct, v ? 2 : 0)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OTHER.map((k) => (
          <div key={k} className="rounded-2xl bg-white p-3 shadow-sm">
            <div className="text-xs text-ink-soft" dir="ltr">{k}</div>
            <div className="text-xl font-bold">{fmtCount(t[k] ?? 0)}</div>
          </div>
        ))}
      </div>
      {days.length > 0 && (
        <div className="card mt-4 overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-ink-soft"><th className="text-start">יום</th>{FUNNEL.slice(0, 5).map((f) => <th key={f.key} className="px-1 text-start font-medium">{f.label}</th>)}</tr></thead>
            <tbody>{days.map((d) => <tr key={d} className="border-t border-charcoal/5"><td className="py-1.5" dir="ltr">{d}</td>{FUNNEL.slice(0, 5).map((f) => <td key={f.key} className="px-1">{fmtCount(dayVal(d, f.key))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="card mt-4 p-5">
        <h2 className="text-lg font-bold">🍽️ נתוני מסעדות</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {stats.data ? `${fmtCount(stats.data.count)} מסעדות · עודכן ${new Date(stats.data.generatedAt).toLocaleDateString('he-IL')}` : 'עדיין לא הורץ seed — האפליקציה מציגה נתוני דמו.'} · חדרים פעילים: {stats.activeSessions}
        </p>
        <button className="btn-secondary mt-3" disabled={seeding} onClick={runSeed}>{seeding ? 'מריץ… (עד דקה)' : 'רענון נתונים מ-Google Places'}</button>
        {seed && (
          <div className={`mt-3 rounded-2xl p-3 text-sm ${seed.ok ? 'bg-basil/10' : 'bg-tomato-soft'}`}>
            {seed.ok ? `✓ נשמרו ${seed.stats?.kept} מסעדות (${seed.stats?.calls} קריאות, ${seed.stats?.failed} נכשלו)` : `✗ ${seed.error}`}
            {seed.logs && seed.logs.length > 0 && <details className="mt-2"><summary>לוג</summary><pre dir="ltr" className="mt-1 max-h-48 overflow-auto text-xs">{seed.logs.join('\n')}</pre></details>}
          </div>
        )}
      </div>
      <p className="py-4 text-center text-xs text-ink-soft">מצב: {backend.kind === 'supabase' ? 'מחובר למסד נתונים' : 'מקומי (ללא מסד נתונים) — המספרים הם רק מהדפדפן הזה'}</p>
    </Screen>
  );
}
