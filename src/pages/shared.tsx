import { Screen } from '../components/Screen';

export function Loading({ text = 'מכינים לכם את השולחן…' }: { text?: string }) {
  return (
    <Screen className="items-center justify-center">
      <div className="text-6xl anim-wiggle" aria-hidden>🍽️</div>
      <p className="mt-4 text-ink-soft" role="status">{text}</p>
    </Screen>
  );
}

export function DemoBadge({ stale = false }: { stale?: boolean }) {
  return (
    <p className="mb-2 rounded-xl bg-mustard/25 px-3 py-1.5 text-center text-xs">
      {stale
        ? 'נתוני Google ישנים מ-30 יום ולא מוצגים, לפי תנאי השימוש שלהם. עד לרענון מוצגות מסעדות לדוגמה.'
        : 'מצב דמו: נתוני מסעדות לדוגמה. אחרי חיבור Google Places יופיעו מסעדות ותמונות אמיתיות.'}
    </p>
  );
}
