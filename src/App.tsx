import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ConsentBanner } from './components/ConsentBanner';
import { trackOnce } from './lib/analytics';
import { preloadBackend } from './lib/backend';
import { loadRestaurants } from './lib/data';
import Landing from './pages/Landing';
import Mode from './pages/Mode';
import Where from './pages/Where';
import Cuisine from './pages/Cuisine';
import Join from './pages/Join';
import { Loading } from './pages/shared';
import { FlowProvider } from './state/flow';

const loadSwipe = () => import('./pages/Swipe');
const loadResult = () => import('./pages/Result');
const loadFriend = () => import('./pages/Friend');
const Swipe = lazy(loadSwipe);
const Result = lazy(loadResult);
const Friend = lazy(loadFriend);
const Privacy = lazy(() => import('./pages/Privacy'));
const Stats = lazy(() => import('./pages/Stats'));

function RouteEffects() {
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    window.gtag?.('event', 'page_view', { page_path: loc.pathname, page_location: window.location.href });
  }, [loc.pathname]);
  return null;
}

export default function App() {
  useEffect(() => {
    // Warm up the heavier screens + data while the user reads the landing page.
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200));
    idle(() => {
      void loadSwipe();
      void loadFriend();
      void loadResult();
      void loadRestaurants().catch(() => undefined);
      preloadBackend();
    });
  }, []);
  useEffect(() => {
    trackOnce('app_open', { path: window.location.pathname, entry: window.location.pathname.startsWith('/s/') ? 'invite' : 'direct' });
  }, []);
  return (
    <BrowserRouter>
      <FlowProvider>
        <RouteEffects />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/start" element={<Mode />} />
            <Route path="/where" element={<Where />} />
            <Route path="/cuisine" element={<Cuisine />} />
            <Route path="/swipe" element={<Swipe />} />
            <Route path="/result" element={<Result />} />
            <Route path="/join" element={<Join />} />
            <Route path="/s/:code" element={<Friend />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <ConsentBanner />
      </FlowProvider>
    </BrowserRouter>
  );
}
