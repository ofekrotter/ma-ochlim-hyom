import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Replaces __SITE_URL__ in index.html (Open Graph tags need absolute URLs for LinkedIn/WhatsApp).
function siteUrl(url: string): Plugin {
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', url.replace(/\/$/, '')),
  };
}

/** Live site. Open Graph tags must be absolute or LinkedIn shows no preview image. Override with VITE_SITE_URL. */
export const DEFAULT_SITE_URL = 'https://ofekrotter-ma-ochlim-lnla.bolt.host';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), siteUrl(env.VITE_SITE_URL || DEFAULT_SITE_URL)],
    build: { target: 'es2020', sourcemap: false },
  };
});
