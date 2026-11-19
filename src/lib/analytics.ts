import { backend } from './backend';
import { GA4_ID, META_PIXEL_ID } from './config';
import { getConsent, onConsent } from './consent';
import { captureUtm, getUtm } from './utm';

type Params = Record<string, string | number | boolean | undefined>;

export type EventName =
  | 'app_open' | 'cta_click' | 'mode_selected' | 'location_set' | 'price_selected' | 'cuisine_selected'
  | 'first_swipe' | 'swipe_like' | 'swipe_skip' | 'session_created' | 'friend_joined' | 'match_found'
  | 'navigate_clicked' | 'share_clicked' | 'solo_result';

// Meta standard events fired alongside our custom ones.
const META_STANDARD: Partial<Record<EventName, string>> = {
  location_set: 'FindLocation',
  session_created: 'Lead',
  match_found: 'CompleteRegistration',
  solo_result: 'CompleteRegistration',
  navigate_clicked: 'Contact',
};

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

let loaded = false;
const queue: { name: EventName; params: Params }[] = [];

function loadScript(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function loadTrackers() {
  if (loaded || getConsent() !== 'granted') return;
  loaded = true;
  if (GA4_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, { ...getUtm(), campaign_source: getUtm().utm_source });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
  }
  if (META_PIXEL_ID) {
    const n = function (...args: unknown[]) {
      // standard Meta Pixel bootstrap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = n as any;
      if (f.callMethod) f.callMethod(...args);
      else f.queue.push(args);
    } as NonNullable<Window['fbq']>;
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    window.fbq = n;
    loadScript('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  }
  // replay events that happened before consent (same page view only)
  queue.splice(0).forEach((e) => sendToTrackers(e.name, e.params));
}

function sendToTrackers(name: EventName, params: Params) {
  const payload = { ...getUtm(), ...params };
  window.gtag?.('event', name, payload);
  if (window.fbq) {
    window.fbq('trackCustom', name, payload);
    const std = META_STANDARD[name];
    if (std) window.fbq('track', std, payload);
  }
}

export function initAnalytics() {
  captureUtm();
  loadTrackers();
  onConsent((c) => c === 'granted' && loadTrackers());
}

/**
 * Track a funnel event.
 * - Always increments the anonymous aggregate counter (for /stats; no personal data).
 * - Sends to GA4 / Meta Pixel only after cookie consent (queued until then).
 * - aggregate=false skips the counter (e.g. avoid double counting a match seen by both friends).
 */
export function track(name: EventName, params: Params = {}, opts: { aggregate?: boolean } = {}) {
  if (opts.aggregate !== false) {
    const counterName = name === 'mode_selected' ? `mode_selected_${params.mode}` : name;
    backend.track(counterName);
  }
  if (getConsent() === 'granted' && loaded) sendToTrackers(name, params);
  else if (getConsent() !== 'denied') queue.push({ name, params });
  if (import.meta.env.DEV) console.debug('[track]', name, { ...getUtm(), ...params });
}

/** Fire an event only once per browser session (e.g. app_open, first_swipe). */
export function trackOnce(name: EventName, params: Params = {}, key: string = name) {
  try {
    const k = `mo:once:${key}`;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
  } catch {
    /* ignore */
  }
  track(name, params);
}
