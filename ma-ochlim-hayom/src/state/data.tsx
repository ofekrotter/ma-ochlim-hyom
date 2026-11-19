import { useEffect, useState } from 'react';
import { loadRestaurants } from '../lib/data';
import type { RestaurantData } from '../lib/types';

export function useRestaurants() {
  const [data, setData] = useState<RestaurantData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    loadRestaurants().then(
      (d) => alive && setData(d),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  return { data, error, retry: () => setAttempt((a) => a + 1) };
}
