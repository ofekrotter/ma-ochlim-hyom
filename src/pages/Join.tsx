import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar } from '../components/Screen';
import { isValidCode, normalizeCode } from '../lib/backend';

export default function Join() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const valid = isValidCode(code);
  return (
    <Screen>
      <TopBar back="/" />
      <form
        className="mt-10 flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) nav(`/s/${code}`);
        }}
      >
        <div className="text-center text-5xl" aria-hidden>🔑</div>
        <h1 className="mt-3 text-center text-3xl font-extrabold">הצטרפות לחדר</h1>
        <p className="mt-1 text-center text-ink-soft">הקלידו את הקוד שקיבלתם מהקבוצה</p>
        <label htmlFor="code" className="sr-only">קוד חדר</label>
        <input
          id="code"
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          maxLength={8}
          placeholder="K7PXM3QD"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          className="mx-auto mt-8 w-full max-w-sm rounded-3xl border-2 border-charcoal/10 bg-white py-4 text-center text-2xl font-extrabold uppercase tracking-[0.18em] placeholder:text-charcoal/20 focus:border-tomato"
        />
        <div className="mt-auto pt-6">
          <button className="btn-primary w-full" disabled={!valid} type="submit">נכנסים 👉</button>
        </div>
      </form>
    </Screen>
  );
}
