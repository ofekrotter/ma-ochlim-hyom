import { Link, useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { track } from '../lib/analytics';
import { useFlow } from '../state/flow';

const FEATURES = [
  { emoji: '🎯', title: 'סינון חכם', text: 'מרחק, מחיר וסוג אוכל' },
  { emoji: '👆', title: 'החלקה כמו בטינדר', text: 'ימינה אהבתי, שמאלה דלג' },
  { emoji: '💘', title: 'מאץ׳ עם חבר', text: 'מחליקים יחד, מסכימים מהר' },
];

const MINI = [
  { e: '🍕', bg: 'from-[#FFD166] to-[#EF476F]', r: '-rotate-12', pos: 'right-[8%] top-6' },
  { e: '🍣', bg: 'from-[#FFB4A2] to-[#E5989B]', r: 'rotate-6', pos: 'left-[10%] top-2' },
  { e: '🍔', bg: 'from-[#FFC971] to-[#C8553D]', r: '-rotate-2', pos: 'left-1/2 -translate-x-1/2 top-10' },
];

export default function Landing() {
  const nav = useNavigate();
  const { reset } = useFlow();
  return (
    <Screen className="justify-between">
      <div className="relative h-56 shrink-0" aria-hidden>
        {MINI.map((m, i) => (
          <div key={i} className={`absolute ${m.pos} ${m.r} anim-pop`} style={{ animationDelay: `${i * 90}ms` }}>
            <div className={`flex h-40 w-32 items-center justify-center rounded-3xl bg-gradient-to-br ${m.bg} text-6xl shadow-[var(--shadow-card)] ring-4 ring-white`}>{m.e}</div>
          </div>
        ))}
        <div dir="ltr" className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-basil px-3 py-1 text-sm font-bold text-white shadow anim-pop" style={{ animationDelay: '400ms' }}>
          It's a match! 🎉
        </div>
      </div>

      <section className="anim-rise text-center">
        <h1 className="text-[2.6rem] font-extrabold leading-[1.05] tracking-tight">
          מה אוכלים <span className="text-tomato">היום?</span>
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-lg leading-snug text-ink-soft">נמאס לריב על איפה לאכול? תחליקו ותמצאו מסעדה ב-30 שניות</p>
        <button
          className="btn-primary mt-6 w-full text-xl"
          onClick={() => {
            track('cta_click', { location: 'landing' });
            reset();
            nav('/start');
          }}
        >
          יאללה, נבחר
        </button>
        <Link to="/join" className="btn-ghost mt-2 text-sm">
          קיבלתם קוד מחבר? הצטרפו כאן
        </Link>
      </section>

      <ul className="mt-4 grid grid-cols-3 gap-2 anim-rise" style={{ animationDelay: '120ms' }}>
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-2xl bg-white/80 px-2 py-3 text-center shadow-sm">
            <div className="text-2xl" aria-hidden>{f.emoji}</div>
            <div className="mt-1 text-[13px] font-bold leading-tight">{f.title}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-ink-soft">{f.text}</div>
          </li>
        ))}
      </ul>

      <footer className="mt-4 text-center text-xs text-ink-soft">
        <Link to="/privacy" className="underline-offset-2 hover:underline">פרטיות</Link>
        <span className="mx-2">·</span>
        <span>נתוני מסעדות: <span translate="no">Google Maps</span></span>
      </footer>
    </Screen>
  );
}
