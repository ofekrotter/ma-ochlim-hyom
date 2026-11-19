import confetti from 'canvas-confetti';

// Drawn on the main thread. canvas-confetti's default instance renders in a
// blob: Web Worker, which a strict CSP (worker-src 'self') blocks. The CSP files
// also allow blob: workers now, but this keeps confetti working under any CSP.
let fire: confetti.CreateTypes | null = null;
function cannon(): confetti.CreateTypes {
  if (!fire) fire = confetti.create(undefined, { resize: true, useWorker: false, disableForReducedMotion: true });
  return fire;
}

export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#d93a2b', '#f4b740', '#2f8a57', '#fff6ec', '#ff8a5b'];
  const shoot = cannon();
  void shoot({ particleCount: 110, spread: 80, origin: { y: 0.6 }, colors, disableForReducedMotion: true });
  setTimeout(() => void shoot({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, disableForReducedMotion: true }), 250);
  setTimeout(() => void shoot({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, disableForReducedMotion: true }), 400);
}
