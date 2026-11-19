import { useNavigate } from 'react-router-dom';
import { Screen, TopBar } from '../components/Screen';
import { track } from '../lib/analytics';
import type { Mode as M } from '../lib/types';
import { useFlow } from '../state/flow';

const OPTIONS: { mode: M; emoji: string; title: string; text: string }[] = [
  { mode: 'solo', emoji: '🙋', title: 'לבד', text: 'מחליקים, ובסוף בוחרים מנצח בדו-קרב קצר' },
  { mode: 'friend', emoji: '👯', title: 'עם חבר', text: 'שולחים קישור, מחליקים במקביל, ומצמצמים ביחד ל-1–3 מקומות' },
];

export default function Mode() {
  const nav = useNavigate();
  const { update } = useFlow();
  return (
    <Screen>
      <TopBar step={1} back="/" />
      <h1 className="mt-6 text-3xl font-extrabold">איך בוחרים היום?</h1>
      <p className="mt-1 text-ink-soft">אפשר לבד, ואפשר לגרור מישהו איתך</p>
      <div className="mt-8 flex flex-col gap-4">
        {OPTIONS.map((o, i) => (
          <button
            key={o.mode}
            onClick={() => {
              update({ mode: o.mode });
              track('mode_selected', { mode: o.mode });
              nav('/where');
            }}
            className="card group flex items-center gap-4 p-5 text-start transition hover:-translate-y-0.5 active:scale-[0.98] anim-rise"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-tomato-soft text-4xl transition group-hover:scale-110" aria-hidden>{o.emoji}</span>
            <span>
              <span className="block text-xl font-bold">{o.title}</span>
              <span className="mt-0.5 block text-[15px] leading-snug text-ink-soft">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
