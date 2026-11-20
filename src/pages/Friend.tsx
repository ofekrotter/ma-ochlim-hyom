import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShareButton } from '../components/Actions';
import { celebrate } from '../components/confetti';
import { useConfirm, useDialogFocus } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FinalCard } from '../components/Final';
import { IconCopy, IconWhatsApp } from '../components/Icons';
import { Rating, Tags } from '../components/Meta';
import { PrimaryPhoto } from '../components/Photo';
import { Screen, TopBar } from '../components/Screen';
import { SwipeButtons, SwipeDeck, useSwipeKeys, type Dir, type SwipeDeckHandle } from '../components/SwipeDeck';
import { track } from '../lib/analytics';
import { isValidCode, normalizeCode } from '../lib/backend';
import { CUISINES } from '../lib/cuisines';
import { formatDistance } from '../lib/geo';
import { PICK_CAP, type FinalOutcomeKind } from '../lib/narrow';
import type { DeckCard, RestaurantData, Settings } from '../lib/types';
import { useRestaurants } from '../state/data';
import { useFriendSession } from '../state/friend';
import { DemoBadge, Loading } from './shared';

function inviteText(code: string, url: string) {
  return `בואו נחליט איפה אוכלים! 🍕🍣🍔\nמחליקים על מסעדות, ובסוף בוחרים ביחד מנצח אחד.\nהקוד שלנו: ${code}\n${url}`;
}

function settingsSummary(s: Settings) {
  const parts = [s.location?.label ?? '', `עד ${formatDistance(s.radius)}`];
  if (s.prices.length) parts.push(s.prices.map((p) => '₪'.repeat(p)).join('/'));
  if (typeof s.minRating === 'number' && s.minRating > 0) parts.push(`דירוג ${s.minRating}+`);
  if (s.sort === 'nearest') parts.push('מהקרוב');
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
  const [confirmDialog, ask] = useConfirm();

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

  const celebrateKey = started && fs.decision.stage === 'winner' ? fs.decision.winnerId : '';
  useEffect(() => {
    if (celebrateKey) celebrate();
  }, [celebrateKey]);

  if (!isValidCode(code)) {
    return (
      <Screen>
        <TopBar back="/" />
        <EmptyState emoji="🔑" title="הקוד לא תקין" text="קוד חדש הוא 8 תווים, למשל K7PXM3QD. קוד ישן של 4 תווים עדיין נפתח.">
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
        <EmptyState emoji="🚪" title="החדר מלא" text="בחדר הזה כבר יש 6 אנשים, וזה המקסימום. אפשר לפתוח חדר חדש.">
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

  if (fs.deckMissing) {
    return (
      <Screen>
        <TopBar back="/" />
        <EmptyState emoji="🔄" title="לא הצלחנו לטעון את המסעדות של החדר" text="כנראה שרשימת המסעדות התעדכנה או לא נטענה עד הסוף. טעינה מחדש בדרך כלל פותרת את זה.">
          <button className="btn-primary" onClick={() => window.location.reload()}>טעינה מחדש</button>
          <button className="btn-secondary" onClick={() => nav('/start')}>פותחים חדר חדש</button>
        </EmptyState>
      </Screen>
    );
  }

  const url = `${window.location.origin}/s/${code}`;
  const total = fs.deck.length;

  // Leaving keeps your spot (the link brings you back), but the others may wait for you.
  const leaveRoom = async () => {
    const ok = await ask({
      title: 'לצאת מהחדר?',
      text: 'אפשר לחזור בכל רגע עם הקישור או הקוד, וההתקדמות שלכם נשמרת. עד אז האחרים אולי יחכו לכם.',
      confirmLabel: 'יציאה מהחדר',
      cancelLabel: 'נשארים',
    });
    if (ok) nav('/');
  };

  const header = (
    <>
      <TopBar
        back={leaveRoom}
        right={
          <button className="btn whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-sm font-bold tracking-widest shadow-sm" onClick={() => setStarted(false)} aria-label={`קוד חדר ${code}, הזמנת חבר`}>
            {code}
          </button>
        }
      />
      <FriendIndicator friend={fs.friend} room={fs.room} total={total} offline={fs.offline} />
      {fs.roundNotice && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-2xl bg-mustard/25 px-3 py-2 text-sm">
          <span className="flex-1">
            {roundNoticeText(fs.roundNotice, fs.activeCount >= 3)}
          </span>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={fs.dismissRoundNotice} aria-label="סגירת ההודעה">
            הבנתי
          </button>
        </div>
      )}
      {confirmDialog}
    </>
  );

  // ── Lobby / invite ──
  if (!started) {
    return (
      <Screen>
        {header}
        <div className="mt-6 text-center anim-rise">
          <div className="text-5xl" aria-hidden>{fs.creator ? '👯' : '🍽️'}</div>
          <h1 className="mt-2 text-3xl font-extrabold">{fs.creator ? 'החדר מוכן! מזמינים את כולם' : 'הוזמנתם להחליט איפה אוכלים!'}</h1>
          <p className="mt-2 text-ink-soft">{settingsSummary(fs.session.settings)} · {total} מקומות</p>
          <p className="mt-2 text-sm text-ink-soft">
            {fs.memberCount > 1 ? `${fs.memberCount} אנשים בחדר. ` : ''}
            {lobbyRuleText(fs.activeCount)}
          </p>
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
            {fs.creator ? (fs.memberCount >= 2 ? 'יש אנשים בחדר — מתחילים! 👆' : 'אפשר להתחיל, אחרים יצטרפו עם הקישור 👆') : 'יאללה, מתחילים 👆'}
          </button>
        </div>
      </Screen>
    );
  }

  const runRound = async (k: 'widen' | 'restart') => {
    // A new round resets the room for everyone in it, so ask first.
    const confirmed = await ask(
      k === 'restart'
        ? {
            title: 'להתחיל מחדש לכולם?',
            text: 'כל מי שבחדר יקבל כרטיסים חדשים מההתחלה, והלייקים וההצבעות של הסיבוב הזה יימחקו. נודיע לאחרים שהתחלתם סיבוב חדש.',
            confirmLabel: 'כן, מתחילים מחדש',
            danger: true,
          }
        : {
            title: 'להרחיב את החיפוש לכולם?',
            text: 'כל מי שבחדר יעבור לסיבוב חדש עם רדיוס גדול יותר, והלייקים של הסיבוב הזה יימחקו. נודיע לאחרים על השינוי.',
            confirmLabel: 'כן, מרחיבים',
          },
    );
    if (!confirmed) return;
    setShowMatches(false);
    setBusyRound(true);
    const ok = await fs.newRound(k);
    setBusyRound(false);
    if (!ok) fs.refresh();
  };
  const cards = fs.matches;
  const group = fs.activeCount >= 3;

  // ── Nothing in common yet ──
  if (fs.phase.kind === 'waiting') {
    return (
      <Screen>
        {header}
        <EmptyState
          emoji="🤝"
          title={group ? 'עוד אין מקום שרוב הקבוצה אהבה' : 'עוד אין מקום ששניכם אהבתם'}
          text={
            group
              ? `${fs.room.finished} מתוך ${fs.room.count} כבר סיימו. הרשימה מתעדכנת כשמצטברת רוב.`
              : fs.friend
                ? `החבר שלך בכרטיס ${Math.min(fs.friend.progress + 1, total)} מתוך ${total}. ברגע ששניכם תאהבו את אותו מקום, הוא ייכנס לרשימה.`
                : 'החבר עוד לא הצטרף. שלחו לו את הקישור, או חזרו להחליק.'
          }
        >
          {!fs.friend && <button className="btn-primary" onClick={() => setStarted(false)}>הזמנת חבר</button>}
          {fs.canSkipOffline && (
            <button className="btn-secondary" onClick={fs.skipOffline}>{group ? 'ממשיכים בלי מי שלא מחובר' : 'החבר לא מחובר — ממשיכים בלעדיו'}</button>
          )}
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
          title={!fs.friend ? 'עדיין לבד בחדר' : group ? 'אין מאץ׳ הפעם' : 'אין מאץ׳ הפעם'}
          text={
            !fs.friend
              ? 'עוד לא הצטרף אף אחד. שלחו את הקישור!'
              : friendLeft && !group
                ? 'החבר לא מחובר, ועדיין אין מקום ששניכם אהבתם. אפשר להמשיך להחליק או לפתוח סיבוב חדש.'
                : group
                  ? 'סיימתם בלי מקום שרוב הקבוצה אהבה. ננסה שוב?'
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

  // ── Single winning restaurant ──
  if (fs.decision.stage === 'winner') {
    const d = fs.decision;
    const winner = cards.find((c) => c.id === d.winnerId);
    if (winner) {
      const tiedNames = d.tiedIds
        .map((id) => cards.find((c) => c.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      const copy = winnerCopy(d.kind, tiedNames, group);
      const otherMatches = cards.filter((c) => c.id !== winner.id);
      return (
        <Screen>
          {header}
          <div className="mt-2 text-center">
            <h1 className="text-3xl font-extrabold">{copy.title}</h1>
            {copy.text && <p className="mt-1 text-ink-soft">{copy.text}</p>}
          </div>
          <div className="mt-4">
            <FinalCard
              r={winner}
              source={data.source}
              context="friend_winner"
              shareText={`החלטנו! אוכלים היום ב${winner.name} 😋 גם אתם מתלבטים? נסו את "מה אוכלים היום":`}
            />
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {otherMatches.length > 0 && (
              <button className="btn-secondary" onClick={() => setShowMatches(true)}>
                צפייה בעוד {otherMatches.length} מקומות שהתאימו
              </button>
            )}
            {fs.canResume && <button className="btn-secondary" onClick={fs.resumeSwiping}>ממשיכים להחליק</button>}
            <RoundButtons busy={busyRound} quiet onRound={runRound} />
          </div>
          {showMatches && (
            <Sheet onClose={() => setShowMatches(false)} title={group ? 'עוד מקומות שרוב הקבוצה אהבה' : 'עוד מקומות ששניכם אהבתם'}>
              <p className="mt-2 text-sm text-ink-soft">אלה שאר המקומות שנכנסו לרשימה המשותפת לפני הבחירה הסופית.</p>
              <MatchList matches={otherMatches} source={data.source} />
            </Sheet>
          )}
        </Screen>
      );
    }
  }

  if (fs.phase.kind === 'holding') {
    const held = fs.phase.ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is DeckCard => Boolean(c));
    return (
      <Screen>
        {header}
        <div className="mt-4 text-center">
          <h1 className="text-3xl font-extrabold">{held.length === 1 ? 'יש כבר מקום אחד' : `יש כבר ${held.length} מקומות`}</h1>
          <p className="mt-1 text-ink-soft">
            {group
              ? `${fs.room.finished} מתוך ${fs.room.count} סיימו. בוחרים מנצח כשכולם מסיימים להחליק.`
              : 'החבר עוד מחליק. בוחרים מנצח כששניכם מסיימים.'}
          </p>
        </div>
        <MatchList matches={held} source={data.source} />
        {fs.canSkipOffline && (
          <button className="btn-primary mt-4" onClick={fs.skipOffline}>
            {group ? 'ממשיכים בלי מי שלא מחובר' : 'החבר לא מחובר — ממשיכים בלעדיו'}
          </button>
        )}
        {fs.canResume && <button className="btn-secondary mt-3" onClick={fs.resumeSwiping}>ממשיכים להחליק</button>}
      </Screen>
    );
  }

  // ── Narrowing (4+ mutuals: pick up to 3) or Final vote (2–6 finalists: pick 1) ──
  if (fs.decision.stage === 'narrow' || fs.decision.stage === 'final_vote') {
    const isFinalVote = fs.decision.stage === 'final_vote';
    const stageCandidates = fs.decision.candidates;
    const waitingIds =
      fs.decision.stage === 'final_vote'
        ? fs.decision.resolution.status === 'waiting' && fs.decision.resolution.myPick
          ? [fs.decision.resolution.myPick]
          : null
        : fs.decision.resolution.status === 'waiting'
          ? fs.decision.resolution.ids
          : null;
    return (
      <Screen>
        {header}
        <NarrowVote
          key={`${fs.session.round}:${fs.decision.stage}`}
          stage={fs.decision.stage}
          cap={isFinalVote ? 1 : PICK_CAP}
          mutuals={cards.filter((c) => stageCandidates.includes(c.id))}
          source={data.source}
          group={group}
          waitingIds={waitingIds}
          pendingFriends={fs.pendingFriends}
          friendAway={fs.friendAway}
          canDecideWithout={fs.canDecideWithout}
          hasFriend={Boolean(fs.friend)}
          draftKey={`mo:pick-draft:${code}:${fs.session.round}:${fs.decision.stage}`}
          saving={fs.savingPicks}
          pickError={fs.pickError}
          onSubmit={isFinalVote ? fs.submitFinalPick : fs.submitPicks}
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
          {group
            ? fs.matches.length === 1
              ? 'מקום אחד שרוב הקבוצה אוהבת. ממשיכים להחליק, או שסיימתם ומצמצמים?'
              : `${fs.matches.length} מקומות שרוב הקבוצה אוהבת. ממשיכים להחליק, או שסיימתם ומצמצמים?`
            : fs.matches.length === 1
              ? 'מקום אחד ששניכם אוהבים. ממשיכים להחליק, או שסיימתם ומצמצמים?'
              : `${fs.matches.length} מקומות ששניכם אוהבים. ממשיכים להחליק, או שסיימתם ומצמצמים?`}
        </p>
      )}
      {data.source === 'sample' && <DemoBadge stale={data.notice === 'stale'} />}
      <SwipeDeck ref={deckRef} cards={fs.deck} index={fs.myProgress} source={data.source} onSwipe={onSwipe} returning={returning} />
      <SwipeButtons onSkip={() => swipeBtn('left')} onLike={() => swipeBtn('right')} onUndo={undo} canUndo={fs.canUndo} disabled={!swiping} />

      {showMatches && (
        <Sheet onClose={() => setShowMatches(false)} title={group ? 'מקומות שרוב הקבוצה אוהבת' : 'מקומות ששניכם אוהבים'}>
          <p className="mt-2 text-sm text-ink-soft">זה עדיין לא הסוף. ממשיכים להחליק, וכשתרצו — סיימתי, ובוחרים מנצח אחד.</p>
          <MatchList matches={fs.matches} source={data.source} />
        </Sheet>
      )}
    </Screen>
  );
}

function FriendIndicator({
  friend,
  room,
  total,
  offline,
}: {
  friend: { online: boolean; progress: number; finished: boolean } | null;
  room: { count: number; finished: number; swiping: number; swipingOnline?: number; swipingOffline?: number };
  total: number;
  offline: boolean;
}) {
  if (offline) {
    return <p role="status" className="mt-1 rounded-full bg-mustard/25 px-3 py-1.5 text-center text-xs">⚠️ אין חיבור — ממשיכים לנסות להתחבר…</p>;
  }
  const dot = friend?.online || room.count >= 3 ? 'bg-basil' : friend ? 'bg-charcoal/30' : 'animate-pulse bg-mustard';
  const label =
    room.count >= 3
      ? `${room.count} אנשים בחדר · ${room.finished} סיימו`
      : !friend
        ? 'מחכים שהחבר יצטרף…'
        : friend.finished
          ? 'החבר שלך סיים להחליק ✓'
          : `החבר שלך בכרטיס ${Math.min(friend.progress + 1, total)} מתוך ${total}${friend.online ? '' : ' (לא מחובר כרגע)'}`;
  return (
    <p role="status" aria-live="polite" className="mt-1 flex items-center justify-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-center text-xs shadow-sm">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
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

function joinHebrewNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} ל-${names[1]}`;
  return `${names.slice(0, -1).join(', ')} ו-${names[names.length - 1]}`;
}

function winnerCopy(kind: FinalOutcomeKind, tiedNames: string[], group: boolean): { title: string; text?: string } {
  const title = 'הולכים לאכול ב… 🎉';
  if (kind === 'tiebreak') {
    const who =
      tiedNames.length >= 2 && tiedNames.length <= 3
        ? `בין ${joinHebrewNames(tiedNames)}`
        : `בין ${tiedNames.length} מקומות`;
    return {
      title,
      text: `היה תיקו ${who} — ההגרלה הכריעה בצורה הוגנת 🎲`,
    };
  }
  if (kind === 'vote') {
    return { title, text: 'נבחר ברוב קולות בסיבוב הסופי!' };
  }
  if (kind === 'compromise') {
    return { title, text: 'המקום שקיבל הכי הרבה קולות.' };
  }
  if (kind === 'agreement') {
    return { title, text: group ? 'המקום היחיד שרוב הקבוצה בחרה.' : 'המקום היחיד ששניכם בחרתם.' };
  }
  if (kind === 'solo') {
    return {
      title,
      text: group ? 'השאר לא הצביעו, אז נשארנו עם הבחירה שלך.' : 'החבר לא היה פה לבחירה, אז נשארנו עם הבחירה שלך.',
    };
  }
  if (kind === 'fallback') {
    return {
      title,
      text: group
        ? 'לא הצלחנו לשמור את הבחירה, אז זה המקום שקיבל הכי הרבה תמיכה בקבוצה.'
        : 'לא הצלחנו לשמור את הבחירה, אז זה המקום המוביל מבין ההתאמות.',
    };
  }
  return {
    title,
    text: group ? 'המקום היחיד שרוב הקבוצה אהבה.' : 'המקום היחיד ששניכם אהבתם.',
  };
}

function MatchList({ matches, source }: { matches: DeckCard[]; source: RestaurantData['source'] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {matches.map((m) => (
        <li key={m.id} className="card overflow-hidden">
          <div className="flex gap-3 p-3">
            <PrimaryPhoto restaurant={m} source={source} cuisine={m.cuisine} alt={m.name} className="h-24 w-24 shrink-0 rounded-2xl" />
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

function NarrowVote({
  stage,
  cap,
  mutuals,
  source,
  group,
  waitingIds,
  pendingFriends,
  friendAway,
  canDecideWithout,
  hasFriend,
  draftKey,
  saving,
  pickError,
  onSubmit,
  onAlone,
  onFallback,
}: {
  stage: 'narrow' | 'final_vote';
  cap: number;
  mutuals: DeckCard[];
  source: RestaurantData['source'];
  group: boolean;
  waitingIds: string[] | null;
  pendingFriends: number;
  friendAway: boolean;
  canDecideWithout: boolean;
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
  // A saved draft can hold places that are no longer on the list (undo, a new
  // like, an earlier narrowing). Never let those invisible ids use up the picks.
  const visible = new Set(mutuals.map((m) => m.id));
  const picked = selected.filter((id) => visible.has(id)).slice(0, cap);
  const toggle = (id: string) => {
    setSelected((prev) => {
      const cur = prev.filter((x) => visible.has(x));
      if (cap === 1) return cur.includes(id) ? [] : [id];
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= cap) return cur;
      return [...cur, id];
    });
  };
  const isFinal = stage === 'final_vote';
  const title = isFinal
    ? (mutuals.length === 2 ? 'ראש בראש! מי מנצח? 🥊' : 'הסיבוב האחרון! 🏆')
    : 'בואו נצמצם 🎯';
  const subtitle = isFinal
    ? (mutuals.length === 2
      ? 'נשארו 2 מקומות. כל אחד בוחר את המנצח שלו — ואם יהיה תיקו, ההגרלה תכריע.'
      : `נשארו ${mutuals.length} מקומות. כל אחד בוחר מקום אחד — ואם יהיה תיקו, ההגרלה תכריע.`)
    : `סיימתם להחליק עם ${mutuals.length} מקומות ש${group ? 'רוב הקבוצה אוהבת' : 'שניכם אוהבים'}. כל אחד בוחר עד ${cap}.`;

  return (
    <div className="mt-2 flex flex-1 flex-col">
      <h1 className="text-center text-3xl font-extrabold">{title}</h1>
      <p className="mt-1 text-center text-ink-soft">{subtitle}</p>
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
            const on = picked.includes(m.id);
            const full = cap > 1 && !on && picked.length >= cap;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggle(m.id)}
                  className={`card flex w-full items-center gap-3 p-3 text-start ${on ? 'ring-2 ring-tomato' : ''} ${full ? 'opacity-50' : ''}`}
                >
                  <PrimaryPhoto restaurant={m} source={source} cuisine={m.cuisine} alt="" className="h-16 w-16 shrink-0 rounded-2xl" />
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
        {waiting
          ? 'הבחירה שלכם נשמרה'
          : cap === 1
            ? (picked.length === 1 ? 'נבחר מקום אחד' : 'בחרו מקום אחד')
            : `נבחרו ${picked.length} מתוך ${cap}`}
      </p>
      {friendAway && hasFriend && (
        <p className="mt-1 text-center text-sm text-ink-soft">החבר לא נראה כבר כמה דקות.</p>
      )}
      {pickError && <p className="mt-2 text-center text-sm text-tomato-dark" role="alert">לא הצלחנו לשמור את הבחירה. נסו שוב, או קחו את המקום המוביל.</p>}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {!waiting && (
          <button className="btn-primary" disabled={picked.length === 0 || saving} onClick={() => onSubmit(picked)}>
            {saving ? 'שומרים…' : 'זו הבחירה שלי'}
          </button>
        )}
        {canDecideWithout && pendingFriends > 0 && (
          <button className="btn-secondary" onClick={onAlone}>{group ? 'ממשיכים בלי מי שלא מחובר' : 'נבחר בלעדיו'}</button>
        )}
        {pickError && <button className="btn-secondary" onClick={onFallback}>להציג את המקום המוביל</button>}
      </div>
    </div>
  );
}

/** Bottom sheet dialog: focus moves in, Tab stays inside, Escape closes, focus returns. */
function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-charcoal/60" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-cream p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="sheet-title" className="text-2xl font-extrabold">{title}</h2>
          <button className="btn-ghost" onClick={onClose} data-autofocus>סגירה</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * How a place gets on the list, matching candidatePlaceIds: in a pair both
 * must like it; once 3+ people are taking part, a majority of them.
 */
export function lobbyRuleText(activeCount: number): string {
  return activeCount >= 3
    ? 'מקום נכנס לרשימה כשרוב מי שמשתתף אהב אותו, ובסוף בוחרים מנצח אחד. אפשר להיות עד 6 בחדר.'
    : 'מקום נכנס לרשימה כשרוב המשתתפים אהבו אותו (בזוג: שניכם), ובסוף בוחרים מנצח אחד. אפשר להיות עד 6 בחדר.';
}

export function roundNoticeText(kind: 'restart' | 'widen', group: boolean): string {
  const who = group ? 'מישהו בחדר' : 'החבר שלך';
  return kind === 'widen'
    ? `${who} הרחיב את החיפוש והתחיל סיבוב חדש, אז הכרטיסים התחלפו.`
    : `${who} התחיל את החדר מחדש, אז הכרטיסים התחלפו ומתחילים מהתחלה.`;
}
