const env = import.meta.env;
export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const GA4_ID: string = env.VITE_GA4_ID || '';
export const META_PIXEL_ID: string = env.VITE_META_PIXEL_ID || '';
export const SITE_URL: string = (env.VITE_SITE_URL || '').replace(/\/$/, '');

export const DECK_LIMIT = 40;
export const RADIUS_MIN = 500;
export const RADIUS_MAX = 5000;
export const RADIUS_DEFAULT = 2000;

export function siteOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : SITE_URL;
}
