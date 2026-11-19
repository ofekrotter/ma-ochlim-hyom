import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpenAt, jerusalemClock } from '../src/lib/hours.ts';

/** A Date whose wall clock in Asia/Jerusalem is the given civil time. */
function atJerusalem(y, month, day, hour, minute) {
  const utc = new Date(Date.UTC(y, month - 1, day, hour, minute));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(utc).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  let ph = Number(parts.hour);
  if (ph === 24) ph = 0;
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), ph, Number(parts.minute));
  return new Date(utc.getTime() - (asUTC - utc.getTime()));
}

const DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

test('jerusalem clock is Asia/Jerusalem, including winter and summer offsets', () => {
  // 2026-11-19 08:00 UTC is Thursday 10:00 IST (UTC+2).
  assert.deepEqual(jerusalemClock(new Date('2026-11-19T08:00:00.000Z')), { day: DAY.thu, minutes: 10 * 60 });
  // 2026-07-15 09:00 UTC is Wednesday 12:00 IDT (UTC+3).
  assert.deepEqual(jerusalemClock(new Date('2026-07-15T09:00:00.000Z')), { day: DAY.wed, minutes: 12 * 60 });
  // 21:30 UTC in July is 00:30 the next day in Israel, not 21:30.
  assert.deepEqual(jerusalemClock(new Date('2026-07-15T21:30:00.000Z')), { day: DAY.thu, minutes: 30 });
});

test('missing or unreadable hours stay in the deck', () => {
  const now = atJerusalem(2026, 11, 19, 10, 0);
  for (const hours of [null, undefined, [], 'nope', {}, [[null]], [['x']], [{ open: 1 }]]) {
    assert.equal(isOpenAt(hours, now), true, JSON.stringify(hours));
  }
});

test('open is inclusive and close is exclusive', () => {
  const hours = [[DAY.thu, 12, 0, DAY.thu, 15, 0]];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 12, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 14, 59)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 15, 0)), false);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 11, 59)), false);
});

test('overnight hours crossing midnight', () => {
  // Thursday 18:00 → Friday 02:00.
  const hours = [[DAY.thu, 18, 0, DAY.fri, 2, 0]];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 17, 59)), false);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 18, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 23, 30)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 1, 59)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 2, 0)), false);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 12, 0)), false);
});

test('period wrapping the week boundary (Saturday night into Sunday)', () => {
  const hours = [[DAY.sat, 22, 0, DAY.sun, 1, 30]];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 21, 0)), false);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 23, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 22, 1, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 22, 1, 30)), false);
});

test('shabbat closure is just whatever periods Places returned', () => {
  // Sun–Thu 11:00–23:00, Friday until 15:00, no Saturday period.
  const hours = [0, 1, 2, 3, 4].map((d) => [d, 11, 0, d, 23, 0]);
  hours.push([DAY.fri, 11, 0, DAY.fri, 15, 0]);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 14, 0)), true, 'friday afternoon');
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 15, 0)), false, 'friday at close');
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 20, 20, 0)), false, 'friday night');
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 12, 0)), false, 'saturday midday');
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 22, 12, 0)), true, 'sunday lunch');
});

test('a friday overnight period still counts as open after midnight on saturday', () => {
  const hours = [[DAY.fri, 22, 0, DAY.sat, 2, 0]];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 1, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 12, 0)), false);
});

test('24-hour sentinel is always open', () => {
  const hours = [[0, 0, 0, -1, 0, 0]];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 21, 3, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 4, 0)), true);
});

test('split lunch and dinner periods', () => {
  const hours = [
    [DAY.thu, 12, 0, DAY.thu, 15, 0],
    [DAY.thu, 18, 0, DAY.thu, 23, 0],
  ];
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 13, 0)), true);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 16, 0)), false);
  assert.equal(isOpenAt(hours, atJerusalem(2026, 11, 19, 19, 0)), true);
});

test('summer time uses the Jerusalem offset, not a fixed UTC+2', () => {
  // Wednesday 12:00 IDT, open 11:00–15:00.
  const hours = [[DAY.wed, 11, 0, DAY.wed, 15, 0]];
  assert.equal(isOpenAt(hours, new Date('2026-07-15T09:00:00.000Z')), true);
  // 21:30 UTC is 00:30 Thursday IDT — Wednesday's hours do not cover it.
  assert.equal(isOpenAt(hours, new Date('2026-07-15T21:30:00.000Z')), false);
  const overnight = [[DAY.wed, 18, 0, DAY.thu, 2, 0]];
  assert.equal(isOpenAt(overnight, new Date('2026-07-15T21:30:00.000Z')), true);
});
