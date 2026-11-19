import { Screen, TopBar } from '../components/Screen';
import { getConsent, setConsent } from '../lib/consent';
import { useState } from 'react';

export default function Privacy() {
  const [c, setC] = useState(getConsent());
  return (
    <Screen>
      <TopBar back="/" />
      <article className="prose-sm mt-4 space-y-4 leading-relaxed">
        <h1 className="text-3xl font-extrabold">מדיניות פרטיות</h1>
        <p className="text-ink-soft">עודכן: נובמבר 2026</p>
        <section>
          <h2 className="text-lg font-bold">בקצרה</h2>
          <p>האפליקציה לא דורשת הרשמה ולא אוספת שם, טלפון או אימייל. אנחנו מודדים שימוש באופן מצטבר כדי לשפר את המוצר.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">מיקום</h2>
          <p>אם תאשרו גישה למיקום, הוא משמש רק בדפדפן שלכם לחישוב מרחק למסעדות. במצב "עם חבר" נקודת החיפוש נשמרת בחדר כדי ששניכם תראו את אותן מסעדות, והחדר נמחק אוטומטית אחרי 24 שעות.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">מדידה ועוגיות</h2>
          <p>אנחנו סופרים אירועים כלליים (למשל "התחילו להחליק", "נמצא מאץ׳") בלי לקשר אותם אליכם. רק אם תאשרו, ייטענו גם Google Analytics ו-Meta Pixel, שמשתמשים בעוגיות למדידת קמפיינים. אפשר לשנות את הבחירה בכל רגע:</p>
          <div className="mt-3 flex gap-2">
            <button className={c === 'granted' ? 'chip-on' : 'chip-off'} onClick={() => { setConsent('granted'); setC('granted'); }}>מאשר/ת מדידה</button>
            <button className={c === 'denied' ? 'chip-on' : 'chip-off'} onClick={() => { setConsent('denied'); setC('denied'); }}>רק הכרחיות</button>
          </div>
          {c === 'denied' && <p className="mt-2 text-sm text-ink-soft">אם כלים כבר נטענו, הם ייעלמו ברענון הבא של הדף.</p>}
        </section>
        <section>
          <h2 className="text-lg font-bold">נתוני מסעדות</h2>
          <p>מידע על מסעדות ותמונות מגיע מ-Google Maps (Google Places API) ומוצג בכפוף לתנאי השימוש של Google. הדירוגים והתמונות שייכים לבעליהם.</p>
        </section>
        <section>
          <h2 className="text-lg font-bold">יצירת קשר</h2>
          <p>שאלות על פרטיות? פנו ליוצר האפליקציה דרך הפרופיל שבו מצאתם את הקישור.</p>
        </section>
      </article>
    </Screen>
  );
}
