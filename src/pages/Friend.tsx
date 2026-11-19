import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NavButtons, ShareButton } from '../components/Actions';
import { celebrate } from '../components/confetti';
import { EmptyState } from '../components/EmptyState';
import { IconCopy, IconWhatsApp } from '../components/Icons';
import { Rating, Tags } from '../components/Meta';
import { Photo, TappablePhoto } from '../components/Photo';
import { Screen, TopBar } from '../components/Screen';
import { SwipeButtons, SwipeDeck, useSwipeKeys, type Dir, type SwipeDeckHandle } from '../components/SwipeDeck';
import { track } from '../lib/analytics';
import { isValidCode, normalizeCode } from '../lib/backend';
import { CUISINES } from '../lib/cuisines';
import { photoUrl } from '../lib/data';
import { formatDistance } from '../lib/geo';
import type { DeckCard, RestaurantData, Settings } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFriendSession } from '../state/friend';
import { DemoBadge, Loading } from './shared';

function inviteText(code: string, url: string) {
  return `בוא נחליט איפה אוכלים! 🍕🍣🍔\nמחליקים על מסעדות כמו בטינדר, וכשיש לנו מאץ׳ — הולכים לאכול.\nהקוד שלנו: ${code}\n${url}`;
}

function settingsSummary(s: Settings) {
  const parts = [s.location?.label ?? '', `עד ${formatDistance(s.radius)}`];
  if (s.prices.length) parts.push(s.prices.map((p) => '₪'.repeat(p)).join('/'));
  if (s.cuisines.length) parts.push(s.cuisines.map((c) => CUISINES[c].label).join(', '));
  return parts.filter(Boolean).join(' · ');
}

export default function Friend() {
  const params = useParams();
  const code = normalizeCode(params.code ?? '');
  const nav = useNavigate();
  const { data, error: dataError, retry } = useRestaurants();
  const fs = useFriendSession(code, data);
  const deckRef = useRef<SwipeDeckHandle>(null);
  const [returning, setReturning] = useState<{ id: string; dir: Dir } | null>(null);
  const startedKey = `mo:started:${code}`;
  const [started, setStarted] = useState(() => sessionStorage.getItem(startedKey) === '1');
  const [busyRound, setBusyRound] = useState(false);
  const [showMatches, setShowMatches] = useState(false);

  // Someone who already swiped (refresh / reconnect) skips the lobby.
  useEffect(() => {
    if (fs.myProgress > 0 && !started) {
      setStarted(true);
      sessionStorage.setItem(startedKey, '1');
    }
  }, [fs.myProgress, started, startedKey]);

  const start = () => {
    setStarted(true);
    sessionStorage.setItem(startedKey, '1');
  };

  const onSwipe = useCallback(
    (dir: Dir, card: DeckCard) => {
      setReturning(null);
      fs.swipe(dir, card);
    },
    [fs],
  );
  const swipeBtn = useCallback((d: Dir) => deckRef.current?.swipe(d), []);
  const undo = useCallback(() => {
    const last = fs.undo();
    if (last) setReturning(last);
  }, [fs]);
  const swiping = fs.ready && started && !fs.finished && !fs.currentMatch;
  useSwipeKeys(swiping, swipeBtn, undo);

  useEffect(() => {
    if (fs.currentMatch) celebrate();
  }, [fs.currentMatch]);

  if (!isValidCode(code)) {
    return (
      <Screen>
        <TopBar back="/" />
        <EmptyState emoji="🔑" title="הקוד לא תקין" text="קוד חדר מורכב מ-4 תווים, למשל K7PX.">
          <Link className="btn-primary" to="/join">הקלדת קוד</Link>
        </EmptyState>
      </Screen>
    );
  }
  if (fs.status === 'not_found') {
    return (
      <Screen>
        <TopBar back="/" />
        <EmptyState emoji="⌛" title="החדר הזה כבר לא קיים" text="חדרים פגים אחרי 24 שעות, או שהקוד שגוי. אפשר לפתוח חדר חדש בשנייה.">
          <button className="btn-primary" onClick={() => nav('/start')}>פותחים חדר חדש</button>
          <Link className="btn-secondary" to="/join">ניסיון עם קוד אחר</Link>
        </EmptyState>
      </Screen>
    );
  }
  if (fs.status === 'full') {
    return (
      <Screen>
        <TopBar back="/" />
        <EmptyState emoji="🚪" title="החדר מלא" text="כבר יש מספיק אנשים בחדר הזה.">
          <button className="btn-primary" onClick={() => nav('/start')}>פותחים חדר משלכם</button>
        </EmptyState>
      </Screen>
    );
  }
  if (fs.status === 'error' || dataError) {
    return (
      <Screen>
        <EmptyState emoji="📡" title="אין חיבור כרגע" text="בדקו את האינטרנט ונסו שוב. ההתקדמות שלכם שמורה.">
          <button className="btn-primary" onClick={() => { retry(); fs.refresh(); }}>נסו שוב</button>
        </EmptyState>
      </Screen>
    );
  }
  if (!fs.ready || !data || !fs.session) return <Loading text="מתחברים לחדר…" />;

  const url = `${window.location.origin}/s/${code}`;
  const total = fs.deck.length;

  const header = (
    <>
      <TopBar
        back="/"
        right={
          <button className="btn whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-sm font-bold tracking-widest shadow-sm" onClick={() => setStarted(false)} aria-label={`קוד חדר ${code}, הזמנת חבר`}>
            {code}
          </button>
        }
      />
      <FriendIndicator friend={fs.friend} total={total} offline={fs.offline} />
    </>
  );

  // ── Lobby / invite ──
  if (!started) {
    return (
      <Screen>
        {header}
        <div className="mt-6 text-center anim-rise">
          <div className="text-5xl" aria-hidden>{fs.creator ? '👯' : '🍽️'}</div>
          <h1 className="mt-2 text-3xl font-extrabold">{fs.creator ? 'החדר מוכן! מזמינים חבר' : 'הוזמנת להחליט איפה אוכלים!'}</h1>
          <p className="mt-2 text-ink-soft">{settingsSummary(fs.session.settings)} · {total} מקומות</p>
        </div>
        {fs.creator && (
          <div className="card mt-6 p-5 text-center anim-pop">
            <p className="text-sm text-ink-soft">קוד החדר</p>
            <p className="mt-1 text-5xl font-extrabold tracking-[0.3em]" dir="ltr">{code}</p>
            <div className="mt-5 flex flex-col gap-3">
              <a
                className="btn bg-[#25D366] px-6 py-4 text-lg text-white shadow-[0_10px_24px_-12px_rgb(37_211_102/0.9)]"
                href={`https://wa.me/?text=${encodeURIComponent(inviteText(code, url))}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('share_clicked', { context: 'invite', method: 'whatsapp' })}
              >
                <IconWhatsApp /> שליחה בוואטסאפ
              </a>
              <CopyLink url={url} />
              <ShareButton title="מה אוכלים היום" text={inviteText(code, '').trim()} url={url} context="invite" />
            </div>
          </div>
        )}
        <div className="mt-auto pt-6">
          <button className="btn-primary w-full" onClick={start}>
            {fs.creator ? (fs.friend ? 'החבר כאן — מתחילים! 👆' : 'אפשר כבר להתחיל להחליק 👆') : 'יאללה, מתחילים 👆'}
          </button>
        </div>
      </Screen>
    );
  }

  // ── Finished ──
  if (fs.finished && !fs.currentMatch) {
    const bothDone = fs.friend?.finished;
    return (
      <Screen>
        {header}
        {fs.matches.length > 0 ? (
          <div className="mt-4 flex flex-1 flex-col">
            <h1 className="text-center text-3xl font-extrabold">💘 המאצ׳ים שלכם</h1>
            {!bothDone && fs.friend && <p className="mt-1 text-center text-sm text-ink-soft">החבר עוד מחליק — אולי יהיו עוד</p>}
            <MatchList matches={fs.matches} source={data.source} />
            <RoundButtons busy={busyRound} onRound={async (k) => { setBusyRound(true); await fs.newRound(k); setBusyRound(false); }} />
          </div>
        ) : bothDone ? (
          <EmptyState emoji="😅" title="אין מאץ׳ הפעם" text="סיימתם את כל הכרטיסים בלי מקום ששניכם אהבתם. ננסה שוב?">
            <RoundButtons busy={busyRound} onRound={async (k) => { setBusyRound(true); const ok = await fs.newRound(k); setBusyRound(false); if (!ok) fs.refresh(); }} />
          </EmptyState>
        ) : (
          <EmptyState
            emoji="⏳"
            title="סיימת! מחכים לחבר"
            text={fs.friend ? `החבר שלך בכרטיס ${Math.min(fs.friend.progress + 1, total)} מתוך ${total}. ברגע שיהיה מאץ׳ — תראו אותו כאן.` : 'החבר עוד לא הצטרף. שלחו לו את הקישור!'}
          >
            {!fs.friend && <button className="btn-primary" onClick={() => setStarted(false)}>הזמנת חבר</button>}
            <button className="btn-secondary" onClick={undo}>חזרה לכרטיס האחרון</button>
          </EmptyState>
        )}
      </Screen>
    );
  }

  // ── Swiping ──
  return (
    <Screen className="!pb-4 overflow-hidden">
      {header}
      <div className="mb-2 mt-1 flex items-center justify-between text-sm text-ink-soft">
        <span aria-live="polite">כרטיס {Math.min(fs.myProgress + 1, total)} מתוך {total}</span>
        {fs.matches.length > 0 ? (
          <button className="btn rounded-full bg-basil px-3 py-1 text-sm text-white" onClick={() => setShowMatches(true)}>
            💘 {fs.matches.length} מאצ׳ים
          </button>
        ) : (
          <span>❤️ {fs.myLikes.size} אהבתי</span>
        )}
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-charcoal/10">
        <div className="h-full rounded-full bg-tomato transition-all" style={{ width: `${(fs.myProgress / Math.max(1, total)) * 100}%` }} />
      </div>
      {data.source === 'sample' && <DemoBadge />}
      <SwipeDeck ref={deckRef} cards={fs.deck} index={fs.myProgress} source={data.source} onSwipe={onSwipe} returning={returning} />
      <SwipeButtons onSkip={() => swipeBtn('left')} onLike={() => swipeBtn('right')} onUndo={undo} canUndo={fs.canUndo} disabled={!swiping} />

      {fs.currentMatch && <MatchOverlay r={fs.currentMatch} source={data.source} onContinue={fs.dismissMatch} />}
      {showMatches && !fs.currentMatch && (
        <Sheet onClose={() => setShowMatches(false)} title="💘 המאצ׳ים שלכם">
          <MatchList matches={fs.matches} source={data.source} />
        </Sheet>
      )}
    </Screen>
  );
}

function FriendIndicator({ friend, total, offline }: { friend: { online: boolean; progress: number; finished: boolean } | null; total: number; offline: boolean }) {
  if (offline) {
    return <p role="status" className="mt-1 rounded-full bg-mustard/25 px-3 py-1.5 text-center text-xs">⚠️ אין חיבור — ממשיכים לנסות להתחבר…</p>;
  }
  return (
    <p role="status" aria-live="polite" className="mt-1 flex items-center justify-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-center text-xs shadow-sm">
      <span className={`inline-block h-2 w-2 rounded-full ${friend?.online ? 'bg-basil' : friend ? 'bg-charcoal/30' : 'animate-pulse bg-mustard'}`} aria-hidden />
      {!friend
        ? 'מחכים שהחבר יצטרף…'
        : friend.finished
          ? 'החבר שלך סיים להחליק ✓'
          : `החבר שלך בכרטיס ${Math.min(friend.progress + 1, total)} מתוך ${total}${friend.online ? '' : ' (לא מחובר כרגע)'}`}
    </p>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          track('share_clicked', { context: 'invite', method: 'copy' });
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('העתיקו את הקישור:', url);
        }
      }}
    >
      <IconCopy size={20} /> {copied ? 'הועתק ✓' : 'העתקת קישור'}
    </button>
  );
}

function RoundButtons({ onRound, busy }: { onRound: (k: 'widen' | 'restart') => void; busy: boolean }) {
  return (
    <div className="mt-4 flex w-full flex-col gap-3">
      <button className="btn-primary" disabled={busy} onClick={() => onRound('widen')}>🔭 הרחיבו רדיוס</button>
      <button className="btn-secondary" disabled={busy} onClick={() => onRound('restart')}>🔄 מתחילים מחדש</button>
    </div>
  );
}

function MatchList({ matches, source }: { matches: DeckCard[]; source: RestaurantData['source'] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {matches.map((m) => (
        <li key={m.id} className="card overflow-hidden">
          <div className="flex gap-3 p-3">
            <Photo src={photoUrl(m, source)} cuisine={m.cuisine} alt={m.name} className="h-24 w-24 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-bold">{m.name}</h3>
              <div className="text-sm"><Rating r={m} /></div>
              <div className="mt-1.5"><Tags r={m} /></div>
            </div>
          </div>
          <div className="px-3 pb-3"><NavButtons r={m} context="friend_match_list" /></div>
        </li>
      ))}
    </ul>
  );
}

function MatchOverlay({ r, source, onContinue }: { r: DeckCard; source: RestaurantData['source']; onContinue: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="match-title" className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-[2rem] bg-cream shadow-2xl anim-pop">
        <div className="relative">
          <TappablePhoto restaurant={r} source={source} cuisine={r.cuisine} alt={r.name} className="aspect-[4/3] w-full" eager />
          <div className="absolute inset-x-0 top-4 text-center">
            <span id="match-title" className="inline-block -rotate-3 rounded-2xl bg-tomato px-5 py-2 text-3xl font-extrabold text-white shadow-lg">
              יש מאץ׳! 🎉
            </span>
          </div>
        </div>
        <div className="p-5">
          <p className="text-sm text-ink-soft">שניכם אהבתם את</p>
          <h2 className="text-2xl font-bold leading-tight">{r.name}</h2>
          <div className="mt-1"><Rating r={r} /></div>
          {r.address && <p className="mt-1 text-sm text-ink-soft">📍 {r.address}</p>}
          <div className="mt-4"><NavButtons r={r} context="friend_match" /></div>
          <button ref={btn} className="btn-ghost mx-auto mt-3 w-full" onClick={onContinue}>
            המשיכו לחפש
          </button>
        </div>
      </div>
    </div>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/60" onClick={onClose}>
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-cream p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] anim-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-extrabold">{title}</h2>
          <button className="btn-ghost" onClick={onClose}>סגירה</button>
        </div>
        {children}
      </div>
    </div>
  );
}
