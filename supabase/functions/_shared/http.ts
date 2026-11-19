import { adminClient } from './admin.ts';
import { adminDecision, nextAdminFailure } from './guard.js';

type AdminRow = { fails: number; windowStart: string; lockedUntil: string | null };

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Constant-time string comparison. Length is mixed in so a mismatch still walks both inputs. */
export function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

type StoredAttempt = { n: number; window_start: string; locked_until: string | null };

function view(row: StoredAttempt | null): AdminRow | null {
  if (!row) return null;
  return { fails: row.n, windowStart: row.window_start, lockedUntil: row.locked_until };
}

// Used when the ops_counters table is not there yet, and as a second brake in this isolate.
let memory: AdminRow | null = null;

async function readAttempts(): Promise<AdminRow | null> {
  try {
    const sb = adminClient();
    const { data, error } = await sb
      .from('ops_counters')
      .select('n, window_start, locked_until')
      .eq('bucket', 'admin:fail')
      .maybeSingle();
    if (error || !data) return memory;
    return view(data as StoredAttempt);
  } catch {
    return memory;
  }
}

async function writeAttempts(next: { fails: number; windowStart: number; lockedUntil: number | null }) {
  memory = {
    fails: next.fails,
    windowStart: new Date(next.windowStart).toISOString(),
    lockedUntil: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null,
  };
  try {
    const sb = adminClient();
    await sb.from('ops_counters').upsert({
      bucket: 'admin:fail',
      n: next.fails,
      window_start: memory.windowStart,
      locked_until: memory.lockedUntil,
    });
  } catch {
    /* the in-memory window still applies in this isolate */
  }
}

async function clearAttempts() {
  memory = null;
  try {
    const sb = adminClient();
    await sb.from('ops_counters').delete().eq('bucket', 'admin:fail');
  } catch {
    /* ignore */
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 350));

export type PasswordResult =
  | { ok: true }
  | { ok: false; status: number; error: string; retryAfter?: number };

/**
 * Admin password or service-role bearer.
 * Eight failures in 15 minutes lock everyone out for 15 minutes, which is the
 * tradeoff that makes guessing the password slower than the lock. A long random
 * ADMIN_PASSWORD is what actually makes guessing pointless.
 */
export async function checkPassword(req: Request): Promise<PasswordResult> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const auth = (req.headers.get('authorization') ?? '').slice(0, 4000);
  if (serviceKey && auth.length <= 4000 && safeEqual(auth, `Bearer ${serviceKey}`)) return { ok: true };

  const now = Date.now();
  const state = await readAttempts();
  const gate = adminDecision(state, now);
  if (!gate.allowed) {
    await pause();
    return { ok: false, status: 429, error: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.', retryAfter: gate.retryAfterSec };
  }

  const expected = Deno.env.get('ADMIN_PASSWORD') ?? '';
  let presented = '';
  try {
    const raw = await req.clone().text();
    if (raw.length <= 4000) {
      const body = JSON.parse(raw) as { password?: unknown };
      if (typeof body?.password === 'string' && body.password.length <= 200) presented = body.password;
    }
  } catch {
    presented = '';
  }

  const match = Boolean(expected) && safeEqual(presented, expected);
  await pause();
  if (!match) {
    await writeAttempts(nextAdminFailure(state, now));
    return { ok: false, status: 401, error: 'סיסמה שגויה' };
  }
  await clearAttempts();
  return { ok: true };
}
