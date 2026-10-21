// Shapes shared by the Electron main process and the UI. All times are epoch milliseconds.

export type SessionStatus = 'running' | 'paused';

export interface ActiveSession {
  id: number;
  status: SessionStatus;
  startedAt: number;
  /** Active time from segments that have already ended. */
  closedMs: number;
  /** Start of the segment currently running, or null when paused. */
  segmentStart: number | null;
  rateCents: number;
  /** Set when Flow paused the session itself (lock screen, sleep, quit, or a crash). */
  autoPausedAt: number | null;
}

export interface Totals {
  ms: number;
  cents: number;
}

export interface TimerState {
  session: ActiveSession | null;
  /** Totals for stopped sessions only; the client adds the live session on top. */
  today: Totals;
  lifetime: Totals;
  rateCents: number;
}

export interface HistoryEntry {
  id: number;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  earnedCents: number;
}

export const MINUTE_MS = 60_000;

/** Active time of a session as of `now`, including the segment currently running. */
export function liveActiveMs(session: ActiveSession | null, now: number): number {
  if (!session) return 0;
  const running = session.segmentStart !== null ? Math.max(0, now - session.segmentStart) : 0;
  return session.closedMs + running;
}

/** Whole minutes only: partial minutes in a session earn nothing. */
export function earnedCents(activeMs: number, rateCents: number): number {
  return Math.floor(activeMs / MINUTE_MS) * rateCents;
}
