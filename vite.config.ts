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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), siteUrl(env.VITE_SITE_URL || '')],
    build: { target: 'es2020', sourcemap: false },
  };
});
