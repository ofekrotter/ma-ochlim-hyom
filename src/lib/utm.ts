const KEY = 'mo:utm';
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
export type Utm = Partial<Record<(typeof FIELDS)[number], string>>;

/** Capture UTMs on first load and persist them for the browser session. */
export function captureUtm(): Utm {
  try {
    const params = new URLSearchParams(window.location.search);
    const fresh: Utm = {};
    for (const f of FIELDS) {
      const v = params.get(f);
      if (v) fresh[f] = v.slice(0, 100);
    }
    if (Object.keys(fresh).length > 0) {
      sessionStorage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
  } catch {
    /* ignore */
  }
  return getUtm();
}

export function getUtm(): Utm {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || '{}') as Utm;
  } catch {
    return {};
  }
}
