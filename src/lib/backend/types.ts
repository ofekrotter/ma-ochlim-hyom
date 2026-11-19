import type { Settings } from '../types';

export interface SessionRow {
  code: string;
  settings: Settings;
  deck: string[];
  round: number;
  created_at: string;
  expires_at: string;
}
export interface MemberRow {
  code: string;
  member_id: string;
  is_creator: boolean;
  round: number;
  progress: number;
  finished: boolean;
  last_seen: string;
  joined_at: string;
}
export interface LikeRow {
  code: string;
  member_id: string;
  round: number;
  place_id: string;
  created_at: string;
}
export interface SessionState {
  session: SessionRow;
  members: MemberRow[];
  likes: LikeRow[];
}
export interface StatsResult {
  totals: Record<string, number>;
  daily: { day: string; event: string; count: number }[];
  activeSessions: number;
  data: { generatedAt: string; count: number } | null;
}
export interface SeedResult {
  ok?: boolean;
  error?: string;
  stats?: { calls: number; failed: number; raw: number; kept: number };
  logs?: string[];
}

export interface Backend {
  kind: 'supabase' | 'local';
  createSession(settings: Settings, deckFor: (code: string) => string[]): Promise<SessionRow>;
  getState(code: string): Promise<SessionState | null>;
  join(code: string, memberId: string, isCreator: boolean): Promise<void>;
  updateMember(code: string, memberId: string, patch: Partial<Pick<MemberRow, 'round' | 'progress' | 'finished'>>): Promise<void>;
  like(code: string, memberId: string, round: number, placeId: string): Promise<void>;
  unlike(code: string, memberId: string, round: number, placeId: string): Promise<void>;
  advanceRound(code: string, expectedRound: number, settings: Settings, deck: string[]): Promise<boolean>;
  subscribe(code: string, onChange: () => void): () => void;
  track(event: string): void;
  stats(password: string): Promise<StatsResult>;
  seed(password: string): Promise<SeedResult>;
}

export class SessionError extends Error {}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** New rooms. 31^8 is too large to scan. Older links of 4 characters still open until they expire. */
export const CODE_LENGTH = 8;
export function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}
export function isValidCode(code: string) {
  return /^[A-Z2-9]{8}$/.test(code) || /^[A-Z2-9]{4}$/.test(code);
}
