import { Screen, TopBar } from '../components/Screen';
import { getConsent, setConsent } from '../lib/consent';
import { useState } from 'react';

export default function Privacy() {
  const [c, setC] = useState(getConsent());
  return (
    <Screen>
      <TopBar back="/" />
      <article className="prose-sm mt-4 space-y-4 leading-relaxed">
        <h1 className="text-3xl font-extrabold">פרטיות ותנאי שימוש</h1>
        <p className="text-ink-soft">עודכן: נובמבר 2026. זהו הסבר קצר, לא ייעוץ משפטי.</p>

        <section>
          <h2 className="text-lg font-bold">מי מפעיל</h2>
          <p>
            «מה אוכלים היום» היא אפליקציה חינמית ולא מסחרית, שמופעלת על ידי אדם פרטי בישראל.
            אין הרשמה, אין תשלום, ואין חשבון משתמש.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">מה נשמר</h2>
          <p>לא נשמרים שם, טלפון או אימייל.</p>
          <ul className="list-disc space-y-1 ps-5">
            <li>במצב חברים נשמרים ל-24 שעות: קוד החדר, נקודת החיפוש, הסינונים, רשימת המסעדות, ומה כל משתתף סימן. כל משתתף מזוהה במזהה אקראי שנשמר רק בדפדפן שלו.</li>
            <li>מי שיש לו את קישור החדר יכול לראות את הנתונים האלה עד שהחדר נסגר. אחרי 24 שעות החדר לא נפתח, והוא נמחק מהמסד בתוך יום נוסף.</li>
            <li>נשמרים מונים מצטברים בלי זיהוי אישי (למשל כמה אנשים התחילו להחליק), כדי להבין אם האפליקציה בשימוש.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold">מיקום</h2>
          <p>
            אם מאשרים גישה למיקום, החישוב של המרחק נעשה בדפדפן ולא נשלח אל Google.
            במצב חברים נקודת החיפוש נשמרת בחדר כדי שכולם יראו את אותה רשימה, ונמחקה יחד עם החדר.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">מדידה ועוגיות</h2>
          <p>
            בלי אישור נטענים רק מה שצריך להפעלת האפליקציה (למשל שמירת החדר בדפדפן).
            רק אחרי אישור נטענים Google Analytics ו-Meta Pixel, שעשויים לעבד מידע גם מחוץ לישראל.
            אפשר לשנות את הבחירה כאן:
          </p>
          <div className="mt-3 flex gap-2">
            <button className={c === 'granted' ? 'chip-on' : 'chip-off'} onClick={() => { setConsent('granted'); setC('granted'); }}>מאשר/ת מדידה</button>
            <button className={c === 'denied' ? 'chip-on' : 'chip-off'} onClick={() => { setConsent('denied'); setC('denied'); }}>רק הכרחיות</button>
          </div>
          {c === 'denied' && <p className="mt-2 text-sm text-ink-soft">אם כלים כבר נטענו, הם ייעלמו ברענון הבא של הדף.</p>}
        </section>

        <section>
          <h2 className="text-lg font-bold">צדדים שלישיים</h2>
          <p>
            החדרים והקבצים יושבים אצל Supabase. פרטי המסעדות והתמונות מגיעים מ-Google Maps (Places).
            כפתורי Wolt ו-Waze רק פותחים את האתר או האפליקציה שלהם, אם בוחרים בכך.
            המידע לא נמכר.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">המידע על המסעדות</h2>
          <p>
            השעות, הדירוג, המחיר, הכתובת והתמונות מוצגים כפי שהתקבלו, ועשויים להיות לא נכונים או לא מעודכנים.
            אין התחייבות שמסעדה פתוחה, שהמחיר נכון, או שההמלצה מתאימה. השימוש הוא על אחריותכם.
            נתוני Google נשמרים אצלנו לכל היותר כ-30 יום ואז צריך לרענן אותם.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">אין שיוך</h2>
          <p>
            האפליקציה לא קשורה ל-Google, ל-Wolt או ל-Waze, והם לא ממליצים עליה ולא מאשרים אותה.
            השמות מופיעים רק כדי לתאר לאן הקישור מוביל. התמונות ופרטי המסעדות שייכים ל-Google ולמי שצילם אותן, ומוצגים עם קרדיט.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">אחריות</h2>
          <p>
            השירות ניתן חינם ובלי אחריות מכל סוג, כולל התאמה למטרה מסוימת או זמינות.
            לא נישא באחריות לנזק שייגרם משימוש באפליקציה או מהסתמכות על המידע שבה, ככל שהדין מאפשר.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">שימוש אסור</h2>
          <p>אין להעמיס על השירות, לאסוף את הנתונים באופן אוטומטי, או להפריע לחדר של מישהו אחר.</p>
        </section>

        <section>
          <h2 className="text-lg font-bold">גיל</h2>
          <p>האפליקציה לא מיועדת לילדים.</p>
        </section>

        <section>
          <h2 className="text-lg font-bold">יצירת קשר</h2>
          <p>שאלות על פרטיות או בקשה להפסיק מדידה: דרך הפרופיל שבו מצאתם את הקישור. אין כאן כתובת דוא״ל בכוונה.</p>
        </section>
      </article>
    </Screen>
  );
}
