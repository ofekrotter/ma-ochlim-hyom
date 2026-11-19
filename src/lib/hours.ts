// Opening hours from Google Places `regularOpeningHours`, evaluated in Asia/Jerusalem.
//
// Storage (compact, on each restaurant):
//   null / omitted / unreadable → hours unknown → the place STAYS in the deck.
//   [] of periods [openDay, openHour, openMinute, closeDay, closeHour, closeMinute]
//   Days are 0=Sunday … 6=Saturday, matching Places and JS.
//   closeDay < 0 → open 24 hours (Places omits `close` for always-open places).
//
// A period may cross midnight (Friday 18:00 → Saturday 02:00) or the week boundary
// (Saturday 22:00 → Sunday 01:00). Close is exclusive, open is inclusive.
// Shabbat is not a special calendar: if Places has no period covering that time, the
// place is closed. Holiday exceptions live on currentOpeningHours, which we do not
// store (it goes stale within a week and would not change the Nearby Search SKU).

export type OpeningPeriod = [number, number, number, number, number, number];

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock day and minutes-from-midnight in Asia/Jerusalem (handles DST). */
export function jerusalemClock(date: Date): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = WEEKDAY[get('weekday')];
  let hour = Number(get('hour'));
  // Some engines report midnight as 24 with hourCycle h23.
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  if (day === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { day: date.getUTCDay(), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
  return { day, minutes: hour * 60 + minute };
}

function weekMinute(day: number, hour: number, minute: number): number {
  return day * 1440 + hour * 60 + minute;
}

/**
 * True when the place should be shown.
 * Unknown or unreadable hours return true on purpose (keep the restaurant).
 */
export function isOpenAt(hours: unknown, date: Date): boolean {
  if (hours == null) return true;
  if (!Array.isArray(hours) || hours.length === 0) return true;
  const { day, minutes } = jerusalemClock(date);
  const now = day * 1440 + minutes;
  let parsed = 0;
  for (const raw of hours) {
    if (!Array.isArray(raw) || raw.length < 6) continue;
    const nums = raw.slice(0, 6).map((n) => Number(n));
    if (!nums.every((n) => Number.isFinite(n))) continue;
    const [od, oh, om, cd, ch, cm] = nums;
    parsed++;
    if (cd < 0) return true;
    const open = weekMinute(od, oh, om);
    const close = weekMinute(cd, ch, cm);
    if (close > open) {
      if (now >= open && now < close) return true;
    } else if (close < open) {
      // Crosses midnight and/or the Sunday boundary.
      if (now >= open || now < close) return true;
    }
  }
  // Nothing we could read → treat as unknown and keep the place.
  if (parsed === 0) return true;
  return false;
}
