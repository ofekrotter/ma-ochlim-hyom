import { haversine } from './geo.ts';

/**
 * Decide whether a Google Places restaurant is the same venue Wolt lists.
 * A match needs a close pin and a name that agrees, in the same script or
 * through a consonant skeleton (פרוזדור ↔ Prozdor). A nearby venue with a
 * different name is not a match: the button stays hidden rather than opening
 * a search full of other restaurants.
 */

export interface WoltCandidate {
  id: string;
  name: string;
  slug: string;
  /** Wolt city slug, e.g. tel-aviv. */
  city: string;
  lat: number;
  lng: number;
  productLine?: string;
}

export interface MatchPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ConfidentMatch {
  placeId: string;
  venueId: string;
  name: string;
  slug: string;
  city: string;
  url: string;
  meters: number;
  /** 0–1. Same-script equality is 1. */
  score: number;
}

const SAME_SCRIPT_METERS = 400;
const TRANSLIT_METERS = 200;
/** Two venues this close, with similar scores, are too ambiguous to pick. */
const AMBIGUOUS_METERS = 160;

const CITY_TOKENS = new Set([
  'תל', 'אביב', 'יפו', 'ירושלים', 'חיפה', 'הרצליה', 'רמת', 'גן', 'גבעתיים',
  'ראשון', 'לציון', 'ישראל', 'סניף', 'של', 'עם',
  'tel', 'aviv', 'yafo', 'jaffa', 'jerusalem', 'haifa', 'herzliya', 'ramat', 'gan',
  'rishon', 'lezion', 'israel', 'the', 'and',
]);

const HE_VOWEL = new Set(['א', 'ה', 'ו', 'י', 'ע']);
const HE_CONS: Record<string, string> = {
  ב: 'b', ג: 'g', ד: 'd', ז: 'z', ח: 'h', ט: 't',
  כ: 'k', ך: 'k', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's',
  פ: 'p', ף: 'f', צ: 'c', ץ: 'c', ק: 'k', ר: 'r', ש: 's', ת: 't',
};

export function woltVenuePage(city: string, slug: string): string {
  return `https://wolt.com/he/isr/${city}/restaurant/${slug}`;
}

export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[’'׳"`״\-–—|/\\.,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokensOf(raw: string): string[] {
  const out: string[] = [];
  for (const t of normalizeName(raw).split(' ')) {
    if (t.length < 2 || CITY_TOKENS.has(t)) continue;
    // "הסביח" and "סביח" are the same word. Only drop ה from a long token.
    const bare = t.startsWith('ה') && t.length >= 5 ? t.slice(1) : t;
    if (bare.length >= 2 && !CITY_TOKENS.has(bare)) out.push(bare);
  }
  return out;
}

/** 1 when the names are the same words, ignoring city suffixes and punctuation. */
export function nameScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja && ja === jb) return 0.98;
  if (ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja))) return 0.9;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length > 0 && shorter.every((t) => longer.includes(t)) && shorter.join('').length >= 4) return 0.86;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (!union || inter === 0) return 0;
  return inter / union;
}

const GENERIC_LATIN = new Set(['bar', 'cafe', 'coffee', 'restaurant', 'the', 'and']);

function scriptsDiffer(a: string, b: string): boolean {
  const he = (s: string) => /[\u0590-\u05FF]/.test(s);
  const lat = (s: string) => /[a-z]/i.test(s);
  const left = he(a) ? 'he' : lat(a) ? 'lat' : 'other';
  const right = he(b) ? 'he' : lat(b) ? 'lat' : 'other';
  if (left === 'other' || right === 'other') return he(a) !== he(b) || lat(a) !== lat(b);
  return left !== right || (he(a) && lat(a)) || (he(b) && lat(b));
}

/** Consonants only, so a Hebrew name can meet the English one Wolt prints. */
export function consonantSkeleton(raw: string): string {
  let out = '';
  for (const ch of normalizeName(raw)) {
    if (HE_CONS[ch]) out += HE_CONS[ch];
    else if (HE_VOWEL.has(ch)) continue;
    else if (/[a-z0-9]/.test(ch)) {
      if (!'aeiouy'.includes(ch)) out += ch;
    }
  }
  return out;
}

function tokenClose(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.abs(a.length - b.length) <= 1 && Math.min(a.length, b.length) >= 2 && levenshtein(a, b) <= 1;
}

/**
 * Cross-script only. Same-script names use nameScore, so two different Hebrew
 * words that share consonants (מחניודה / מחנה יהודה) are not a match.
 * Branch suffixes on the venue ("| בוגרשוב") can be extra tokens.
 */
export function translitScore(a: string, b: string): number {
  if (!scriptsDiffer(a, b)) return 0;
  const left = tokensOf(a)
    .filter((t) => !GENERIC_LATIN.has(t))
    .map((t) => consonantSkeleton(t))
    .filter((s) => s.length >= 2);
  const right = tokensOf(b)
    .map((t) => consonantSkeleton(t))
    .filter((s) => s.length >= 2);
  if (left.length === 0 || right.length === 0) return 0;
  const hits = left.filter((tok) => right.some((other) => tokenClose(tok, other))).length;
  if (hits < left.length) return 0;
  // The venue's own name is the first tokens. A hit only on a street suffix
  // ("נביא" inside "סילי קיד | יונה הנביא") is not the restaurant.
  const head = right.slice(0, 2);
  const headHits = head.filter((tok) => left.some((placeTok) => tokenClose(placeTok, tok))).length;
  if (headHits === 0) return 0;
  if (left.some((t) => t.length >= 3)) return 0.88;
  return 0.8;
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function acceptable(score: number, translit: number, meters: number): boolean {
  if (score >= 0.86 && meters <= SAME_SCRIPT_METERS) return true;
  if (score >= 0.72 && meters <= 180) return true;
  // A real word (3+ consonants) can be a block away. A 2-consonant skeleton (Mela / מלה) only inside the building.
  if (translit >= 0.88 && meters <= TRANSLIT_METERS) return true;
  if (translit >= 0.8 && meters <= 60) return true;
  return false;
}

/**
 * Pick at most one venue. Returns null when nothing is close enough, the name
 * does not agree, or two venues are similarly plausible.
 * Non-restaurants (grocery, pharmacy, …) are ignored when productLine is set.
 */
export function matchWoltVenue(place: MatchPlace, venues: WoltCandidate[]): ConfidentMatch | null {
  const ranked: { v: WoltCandidate; meters: number; score: number; translit: number }[] = [];
  for (const v of venues) {
    if (!v.slug || !v.city || !v.name) continue;
    if (v.productLine && v.productLine !== 'restaurant') continue;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
    const meters = haversine(place.lat, place.lng, v.lat, v.lng);
    if (meters > SAME_SCRIPT_METERS) continue;
    const score = nameScore(place.name, v.name);
    const translit = translitScore(place.name, v.name);
    if (!acceptable(score, translit, meters)) continue;
    const shortSk = consonantSkeleton(place.name).length >= 2 && consonantSkeleton(place.name) === consonantSkeleton(v.name) && meters <= 60;
    ranked.push({ v, meters, score: Math.max(score, translit, shortSk ? 0.8 : 0), translit });
  }
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => b.score - a.score || a.meters - b.meters);
  const best = ranked[0];
  const second = ranked[1];
  if (second && second.v.id !== best.v.id) {
    const similarScore = best.score - second.score < 0.08;
    const bothClose = second.meters <= AMBIGUOUS_METERS && best.meters <= AMBIGUOUS_METERS;
    // Two branches of the same name: the one at the door wins over one down the street.
    const bestIsTheBuilding = best.meters <= 40 && second.meters - best.meters >= 70;
    if (similarScore && bothClose && !bestIsTheBuilding) return null;
  }
  return {
    placeId: place.id,
    venueId: best.v.id,
    name: best.v.name,
    slug: best.v.slug,
    city: best.v.city,
    url: woltVenuePage(best.v.city, best.v.slug),
    meters: Math.round(best.meters),
    score: Math.round(best.score * 100) / 100,
  };
}
