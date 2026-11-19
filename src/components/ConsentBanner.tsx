import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GA4_ID, META_PIXEL_ID } from '../lib/config';
import { getConsent, setConsent } from '../lib/consent';

export function ConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Only relevant if there is something to load
    if ((GA4_ID || META_PIXEL_ID) && getConsent() === null) {
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);
  if (!show) return null;
  const choose = (c: 'granted' | 'denied') => {
    setConsent(c);
    setShow(false);
  };
  return (
    <div role="dialog" aria-live="polite" aria-label="הסכמה לעוגיות" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md anim-rise rounded-3xl bg-charcoal p-4 text-white shadow-2xl">
      <p className="text-sm leading-relaxed">
        🍪 אנחנו משתמשים בעוגיות למדידה (Google Analytics ו-Meta) כדי לשפר את האפליקציה.{' '}
        <Link to="/privacy" className="underline">מדיניות פרטיות</Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button className="btn flex-1 bg-white px-4 py-2.5 text-charcoal" onClick={() => choose('granted')}>מאשר/ת</button>
        <button className="btn flex-1 border border-white/30 px-4 py-2.5 text-white" onClick={() => choose('denied')}>רק הכרחיות</button>
      </div>
    </div>
  );
}
