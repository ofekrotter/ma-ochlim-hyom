import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NavButtons, ShareButton } from '../components/Actions';
import { celebrate } from '../components/confetti';
import { EmptyState } from '../components/EmptyState';
import { FinalCard } from '../components/Final';
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
import { PICK_CAP, type ShortlistKind } from '../lib/narrow';
import type { DeckCard, RestaurantData, Settings } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFriendSession } from '../state/friend';
import { DemoBadge, Loading } from './shared';

function inviteText(code: string, url: string) {
  return `בוא נחליט איפה אוכלים! 🍕🍣🍔\nמחליקים על מסעדות כמו בטינדר, ואז מצמצמים ביחד לכמה מקומות.\nהקוד שלנו: ${code}\n${url}`;
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
  const swiping = fs.ready && started && fs.phase.kind === 'swipe' && fs.myProgress < fs.deck.length;
  useSwipeKeys(swiping, swipeBtn, undo);

  const finalIds =
    fs.fallbackIds ??
    (fs.phase.kind === 'final' ? fs.phase.ids : fs.phase.kind === 'narrow' && fs.resolution?.status === 'ready' ? fs.resolution.ids : null);
  const finalKind: ShortlistKind | 'direct' | 'fallback' | null = fs.fallbackIds
    ? 'fallback'
    : fs.phase.kind === 'final'
      ? 'direct'
      : (fs.resolution?.kind ?? null);
  const celebrateKey = started && finalIds ? finalIds.join(',') : '';
  useEffect(() => {
    if (celebrateKey) celebrate();
  }, [celebrateKey]);

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

  const runRound = async (k: 'widen' | 'restart') => {
    setBusyRound(true);
    const ok = await fs.newRound(k);
    setBusyRound(false);
    if (!ok) fs.refresh();
  };
  const cards = fs.matches;

  // ── Nothing in common yet ──
  if (fs.phase.kind === 'waiting') {
    return (
      <Screen>
        {header}
        <EmptyState
          emoji="🤝"
          title="עוד אין מקום ששניכם אהבתם"
          text={
            fs.friend
              ? `החבר שלך בכרטיס ${Math.min(fs.friend.progress + 1, total)} מתוך ${total}. ברגע ששניכם תאהבו את אותו מקום, הוא ייכנס לרשימה.`
              : 'החבר עוד לא הצטרף. שלחו לו את הקישור, או חזרו להחליק.'
          }
        >
          {!fs.friend && <button className="btn-primary" onClick={() => setStarted(false)}>הזמנת חבר</button>}
          {!fs.finished && <button className="btn-primary" onClick={fs.resumeSwiping}>ממשיכים להחליק</button>}
          {fs.canUndo && <button className="btn-secondary" onClick={undo}>חזרה לכרטיס האחרון</button>}
        </EmptyState>
      </Screen>
    );
  }

  if (fs.phase.kind === 'empty') {
    const friendLeft = Boolean(fs.friend && !fs.friend.online);
    return (
      <Screen>
        {header}
        <EmptyState
          emoji="😅"
          title={fs.friend ? 'אין מאץ׳ הפעם' : 'עדיין לבד בחדר'}
          text={
            !fs.friend
              ? 'החבר עוד לא הצטרף. שלחו לו את הקישור!'
              : friendLeft
                ? 'החבר לא מחובר, ועדיין אין מקום ששניכם אהבתם. אפשר להמשיך להחליק או לפתוח סיבוב חדש.'
                : 'סיימתם את הכרטיסים בלי מקום ששניכם אהבתם. ננסה שוב?'
          }
        >
          {!fs.friend && <button className="btn-primary" onClick={() => setStarted(false)}>הזמנת חבר</button>}
          {!fs.finished && <button className="btn-primary" onClick={fs.resumeSwiping}>ממשיכים להחליק</button>}
          <RoundButtons busy={busyRound} onRound={runRound} />
        </EmptyState>
      </Screen>
    );
  }

  // ── 1–3 places, or a finished re-vote ──
  if (finalIds) {
    const chosen = finalIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is DeckCard => Boolean(c));
    const copy = shortlistCopy(chosen.length, finalKind);
    return (
      <Screen>
        {header}
        <div className="mt-2 text-center">
          <h1 className="text-3xl font-extrabold">{copy.title}</h1>
          {copy.text && <p className="mt-1 text-ink-soft">{copy.text}</p>}
        </div>
        {chosen.length === 1 ? (
          <div className="mt-4">
            <FinalCard
              r={chosen[0]}
              source={data.source}
              context="friend_shortlist"
              shareText={`החלטנו! אוכלים היום ב${chosen[0].name} 😋 גם אתם מתלבטים? נסו את "מה אוכלים היום":`}
            />
          </div>
        ) : (
          <Shortlist matches={chosen} source={data.source} />
        )}
        <div className="mt-4 flex flex-col gap-3">
          {fs.canResume && <button className="btn-secondary" onClick={fs.resumeSwiping}>ממשיכים להחליק</button>}
          <RoundButtons busy={busyRound} quiet onRound={runRound} />
        </div>
      </Screen>
    );
  }

  // ── Re-vote among the mutual likes ──
  if (fs.phase.kind === 'narrow') {
    return (
      <Screen>
        {header}
        <NarrowVote
          mutuals={cards.filter((c) => fs.phase.kind === 'narrow' && fs.phase.ids.includes(c.id))}
          source={data.source}
          reason={fs.phase.reason}
          waitingIds={fs.resolution?.status === 'waiting' ? fs.resolution.ids : null}
          pendingFriends={fs.pendingFriends}
          friendAway={fs.friendAway}
          hasFriend={Boolean(fs.friend)}
          draftKey={`mo:pick-draft:${code}:${fs.session.round}`}
          saving={fs.savingPicks}
          pickError={fs.pickError}
          onSubmit={fs.submitPicks}
          onAlone={fs.continueAlone}
          onFallback={fs.useFallback}
        />
        {fs.canResume && <button className="btn-ghost mx-auto mt-2" onClick={fs.resumeSwiping}>רגע, עוד לא סיימתי להחליק</button>}
      </Screen>
    );
  }

  // ── Swiping ──
  return (
    <Screen className="!pb-4 overflow-hidden">
      {header}
      <div className="mb-2 mt-1 flex items-center justify-between gap-2 text-sm text-ink-soft">
        <span aria-live="polite">כרטיס {Math.min(fs.myProgress + 1, total)} מתוך {total}</span>
        <span className="flex items-center gap-2">
          {fs.matches.length > 0 ? (
            <button className="btn rounded-full bg-basil px-3 py-1 text-sm text-white" onClick={() => setShowMatches(true)}>
              🍽️ {fs.matches.length} ביחד
            </button>
          ) : (
            <span>❤️ {fs.myLikes.size} אהבתי</span>
          )}
          <button className="btn whitespace-nowrap rounded-full bg-charcoal px-3 py-1 text-sm text-white" onClick={fs.stopSwiping}>
            סיימתי
          </button>
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-charcoal/10">
        <div className="h-full rounded-full bg-tomato transition-all" style={{ width: `${(fs.myProgress / Math.max(1, total)) * 100}%` }} />
      </div>
      {fs.matches.length > 0 && (
        <p className="mb-2 text-center text-sm text-ink-soft">
          {fs.matches.length === 1
            ? 'מקום אחד ששניכם אוהבים. ממשיכים להחליק, או שסיימתם ומצמצמים?'
            : `${fs.matches.length} מקומות ששניכם אוהבים. ממשיכים להחליק, או שסיימתם ומצמצמים?`}
        </p>
      )}
      {data.source === 'sample' && <DemoBadge />}
      <SwipeDeck ref={deckRef} cards={fs.deck} index={fs.myProgress} source={data.source} onSwipe={onSwipe} returning={returning} />
      <SwipeButtons onSkip={() => swipeBtn('left')} onLike={() => swipeBtn('right')} onUndo={undo} canUndo={fs.canUndo} disabled={!swiping} />

      {showMatches && (
        <Sheet onClose={() => setShowMatches(false)} title="מקומות ששניכם אוהבים">
          <p className="mt-2 text-sm text-ink-soft">זה עדיין לא הסוף. ממשיכים להחליק, וכשתרצו — סיימתי, ומצמצמים ל-1–3.</p>
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

function RoundButtons({ onRound, busy, quiet = false }: { onRound: (k: 'widen' | 'restart') => void; busy: boolean; quiet?: boolean }) {
  return (
    <div className={`${quiet ? 'mt-2' : 'mt-4'} flex w-full flex-col gap-3`}>
      <button className={quiet ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => onRound('widen')}>🔭 הרחיבו רדיוס</button>
      <button className={quiet ? 'btn-ghost' : 'btn-secondary'} disabled={busy} onClick={() => onRound('restart')}>🔄 מתחילים מחדש</button>
    </div>
  );
}

function shortlistCopy(n: number, kind: ShortlistKind | 'direct' | 'fallback' | null): { title: string; text?: string } {
  if (kind === 'compromise') {
    return { title: n === 1 ? 'הולכים לאכול ב… 🎉' : `נשארו ${n} מקומות`, text: 'לא בחרתם את אותם מקומות, אז אלה שקיבלו הכי הרבה קולות.' };
  }
  if (kind === 'solo') {
    return {
      title: n === 1 ? 'הולכים לאכול ב… 🎉' : `הנה ${n} המקומות`,
      text: 'החבר לא היה פה לבחירה, אז נשארנו עם מה שאתם בחרתם.',
    };
  }
  if (kind === 'fallback') {
    return { title: `הנה ${n} מקומות`, text: 'לא הצלחנו לשמור את הבחירה, אז אלה הראשונים ששניכם אהבתם.' };
  }
  if (kind === 'agreement') {
    return { title: n === 1 ? 'הולכים לאכול ב… 🎉' : `הנה ${n} המקומות ששניכם בחרתם` };
  }
  return { title: n === 1 ? 'הולכים לאכול ב… 🎉' : `הנה ${n} המקומות ששניכם אוהבים`, text: n > 1 ? 'אפשר ללכת לכל אחד מהם.' : undefined };
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
        </li>
      ))}
    </ul>
  );
}

function Shortlist({ matches, source }: { matches: DeckCard[]; source: RestaurantData['source'] }) {
  return (
    <ul className="mt-4 flex flex-col gap-4">
      {matches.map((m) => (
        <li key={m.id} className="card overflow-hidden">
          <TappablePhoto restaurant={m} source={source} cuisine={m.cuisine} alt={m.name} className="h-40 w-full" eager />
          <div className="p-4">
            <h2 className="text-xl font-bold leading-tight">{m.name}</h2>
            <div className="mt-1"><Rating r={m} /></div>
            {m.address && <p className="mt-1 text-sm text-ink-soft">📍 {m.address}</p>}
            <div className="mt-2"><Tags r={m} /></div>
            <div className="mt-4"><NavButtons r={m} context="friend_shortlist" /></div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NarrowVote({
  mutuals,
  source,
  reason,
  waitingIds,
  pendingFriends,
  friendAway,
  hasFriend,
  draftKey,
  saving,
  pickError,
  onSubmit,
  onAlone,
  onFallback,
}: {
  mutuals: DeckCard[];
  source: RestaurantData['source'];
  reason: 'target' | 'stopped';
  waitingIds: string[] | null;
  pendingFriends: number;
  friendAway: boolean;
  hasFriend: boolean;
  draftKey: string;
  saving: boolean;
  pickError: boolean;
  onSubmit: (ids: string[]) => void;
  onAlone: () => void;
  onFallback: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || '[]');
      return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(selected));
    } catch {
      /* ignore */
    }
  }, [draftKey, selected]);
  const waiting = waitingIds !== null;
  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= PICK_CAP) return prev;
      return [...prev, id];
    });
  };
  return (
    <div className="mt-2 flex flex-1 flex-col">
      <h1 className="text-center text-3xl font-extrabold">בואו נצמצם 🎯</h1>
      <p className="mt-1 text-center text-ink-soft">
        {reason === 'target'
          ? `יש ${mutuals.length} מקומות ששניכם אוהבים. כל אחד בוחר עד ${PICK_CAP}.`
          : `סיימתם להחליק עם ${mutuals.length} מקומות ביחד. כל אחד בוחר עד ${PICK_CAP}.`}
      </p>
      {waiting ? (
        <div className="mt-6">
          <p className="text-center text-lg font-bold" role="status">
            {pendingFriends > 1 ? 'מחכים לשאר החברים…' : 'מחכים שהחבר יבחר…'}
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {mutuals.filter((m) => waitingIds.includes(m.id)).map((m) => (
              <li key={m.id} className="card px-4 py-3 font-bold">{m.name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {mutuals.map((m) => {
            const on = selected.includes(m.id);
            const full = !on && selected.length >= PICK_CAP;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggle(m.id)}
                  className={`card flex w-full items-center gap-3 p-3 text-start ${on ? 'ring-2 ring-tomato' : ''} ${full ? 'opacity-50' : ''}`}
                >
                  <Photo src={photoUrl(m, source)} cuisine={m.cuisine} alt="" className="h-16 w-16 shrink-0 rounded-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold">{m.name}</span>
                    <span className="mt-0.5 block text-sm"><Rating r={m} /></span>
                  </span>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-tomato bg-tomato text-white' : 'border-charcoal/20'}`} aria-hidden>
                    {on ? '✓' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-center text-sm text-ink-soft" aria-live="polite">
        {waiting ? 'הבחירה שלכם נשמרה' : `נבחרו ${selected.length} מתוך ${PICK_CAP}`}
      </p>
      {friendAway && hasFriend && (
        <p className="mt-1 text-center text-sm text-ink-soft">החבר לא נראה כבר כמה דקות.</p>
      )}
      {pickError && <p className="mt-2 text-center text-sm text-tomato-dark" role="alert">לא הצלחנו לשמור את הבחירה. נסו שוב, או קחו את המקומות הראשונים.</p>}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {!waiting && (
          <button className="btn-primary" disabled={selected.length === 0 || saving} onClick={() => onSubmit(selected)}>
            {saving ? 'שומרים…' : 'זו הבחירה שלי'}
          </button>
        )}
        {friendAway && hasFriend && pendingFriends > 0 && (
          <button className="btn-secondary" onClick={onAlone}>נבחר בלעדיו</button>
        )}
        {pickError && <button className="btn-secondary" onClick={onFallback}>להציג את 3 המקומות הראשונים</button>}
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
