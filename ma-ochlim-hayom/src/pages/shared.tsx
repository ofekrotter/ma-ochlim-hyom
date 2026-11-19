import { Screen } from '../components/Screen';

export function Loading({ text = 'מכינים לכם את השולחן…' }: { text?: string }) {
  return (
    <Screen className="items-center justify-center">
      <div className="text-6xl anim-wiggle" aria-hidden>🍽️</div>
      <p className="mt-4 text-ink-soft" role="status">{text}</p>
    </Screen>
  );
}

export function DemoBadge() {
  return (
    <p className="mb-2 rounded-xl bg-mustard/25 px-3 py-1.5 text-center text-xs">
      מצב דמו: נתוני מסעדות לדוגמה. אחרי חיבור Google Places יופיעו מסעדות ותמונות אמיתיות.
    </p>
  );
}
