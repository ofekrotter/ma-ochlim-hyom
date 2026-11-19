const KEY = 'mo:consent';
export type Consent = 'granted' | 'denied' | null;
const listeners = new Set<(c: Consent) => void>();

export function getConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}
export function setConsent(c: Exclude<Consent, null>) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(c));
}
export function onConsent(l: (c: Consent) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
