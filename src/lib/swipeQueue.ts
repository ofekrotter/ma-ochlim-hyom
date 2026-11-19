type Dir = 'left' | 'right';

/** Swipes asked for while a card is still flying out wait here (keys and buttons alike). */
export const MAX_QUEUED_SWIPES = 10;

/**
 * Pure queue step used by the deck: a swipe asked for while the top card is
 * still animating is kept (up to MAX_QUEUED_SWIPES) instead of dropped.
 */
export function enqueueSwipe(queue: Dir[], dir: Dir, remaining: number): Dir[] {
  if (queue.length >= Math.min(MAX_QUEUED_SWIPES, Math.max(0, remaining))) return queue;
  return [...queue, dir];
}

/** RTL photo paging: a tap on the left half is "next" (+1), on the right half "previous" (-1). */
export function photoTapDirection(clientX: number, left: number, width: number): -1 | 1 {
  return clientX < left + width / 2 ? 1 : -1;
}

