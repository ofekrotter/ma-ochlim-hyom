import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { RADIUS_DEFAULT } from '../lib/config';
import type { Settings } from '../lib/types';

const KEY = 'mo:settings';
const DEFAULTS: Settings = { mode: 'solo', location: null, radius: RADIUS_DEFAULT, prices: [], cuisines: [], minRating: null, sort: 'mixed' };

interface FlowCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}
const Ctx = createContext<FlowCtx | null>(null);

function load(): Settings {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return s ? { ...DEFAULTS, ...s } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function FlowProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings((s) => ({ ...DEFAULTS, location: s.location })), []);
  return <Ctx.Provider value={{ settings, update, reset }}>{children}</Ctx.Provider>;
}

export function useFlow() {
  const c = useContext(Ctx);
  if (!c) throw new Error('FlowProvider missing');
  return c;
}
