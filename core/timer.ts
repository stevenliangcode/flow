import type { DatabaseSync } from 'node:sqlite';
import {
  MINUTE_MS,
  earnedCents,
  type ActiveSession,
  type HistoryEntry,
  type TimerState,
  type Totals,
} from '../shared/types';

/**
 * The app records a heartbeat every 15s while running. If it crashes or loses power, the
 * session is paused as of its last heartbeat once this much time has passed.
 */
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const DEFAULT_RATE_CENTS = 100;

/** An action that isn't valid right now; its message is shown to the user. */
export class TimerError extends Error {}

interface SessionRow {
  id: number;
  started_at: number;
  status: 'running' | 'paused' | 'stopped';
  rate_cents: number;
  last_heartbeat: number;
  auto_paused_at: number | null;
}

export class Timer {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- actions -----------------------------------------------------------

  start(): TimerState {
    return this.tx(() => {
      if (this.activeSession()) throw new TimerError('A session is already in progress');
      const now = this.now();
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO sessions (started_at, status, rate_cents, last_heartbeat)
           VALUES (?, 'running', ?, ?)`,
        )
        .run(now, this.rateCents(), now);
      this.openSegment(Number(lastInsertRowid), now);
    });
  }

  pause(): TimerState {
    return this.tx(() => {
      const session = this.requireSession('running');
      this.closeSegment(session.id, this.now());
      this.db.prepare(`UPDATE sessions SET status = 'paused' WHERE id = ?`).run(session.id);
    });
  }

  resume(): TimerState {
    return this.tx(() => {
      const session = this.requireSession('paused');
      const now = this.now();
      this.openSegment(session.id, now);
      this.db
        .prepare(
          `UPDATE sessions SET status = 'running', last_heartbeat = ?, auto_paused_at = NULL
           WHERE id = ?`,
        )
        .run(now, session.id);
    });
  }

  stop(): TimerState {
    return this.tx(() => {
      const session = this.requireSession();
      const now = this.now();
      if (session.status === 'running') this.closeSegment(session.id, now);
      this.db
        .prepare(`UPDATE sessions SET status = 'stopped', ended_at = ? WHERE id = ?`)
        .run(now, session.id);
    });
  }

  /**
   * Pauses a running session right now because the user went away (screen locked, computer
   * asleep, Flow quit). Unlike pause(), it shows the "auto-paused" notice. No-op otherwise.
   */
  autoPause(): TimerState {
    return this.tx(() => {
      const session = this.activeSession();
      if (session?.status !== 'running') return;
      const now = this.now();
      this.closeSegment(session.id, now);
      this.db
        .prepare(`UPDATE sessions SET status = 'paused', auto_paused_at = ? WHERE id = ?`)
        .run(now, session.id);
    });
  }

  /** Keeps a running session alive. Does nothing if it has already been auto-paused. */
  heartbeat(): TimerState {
    return this.tx(() => {
      const session = this.activeSession();
      if (session?.status === 'running') {
        this.db
          .prepare(`UPDATE sessions SET last_heartbeat = ? WHERE id = ?`)
          .run(this.now(), session.id);
      }
    });
  }

  setRate(rateCents: number): TimerState {
    if (!Number.isInteger(rateCents) || rateCents < 1 || rateCents > 100_000) {
      throw new TimerError('Rate must be a whole number of cents between 1 and 100000');
    }
    return this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('rate_cents', ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(rateCents));
    });
  }

  // ---- reads -------------------------------------------------------------

  state(): TimerState {
    return this.tx(() => {});
  }

  history(limit = 100): HistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.started_at, s.ended_at, s.rate_cents,
                COALESCE(SUM(g."end" - g.start), 0) AS active_ms
         FROM sessions s LEFT JOIN segments g ON g.session_id = s.id
         WHERE s.status = 'stopped'
         GROUP BY s.id
         ORDER BY s.started_at DESC
         LIMIT ?`,
      )
      .all(limit) as { id: number; started_at: number; ended_at: number; rate_cents: number; active_ms: number }[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      activeMs: r.active_ms,
      earnedCents: earnedCents(r.active_ms, r.rate_cents),
    }));
  }

  // ---- internals ---------------------------------------------------------

  /**
   * Runs a write in a transaction after first applying any overdue auto-pause,
   * then returns the resulting state.
   */
  private tx(fn: () => void): TimerState {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.applyAutoPause();
      fn();
      const state = this.buildState();
      this.db.exec('COMMIT');
      return state;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * If a running session has gone quiet for longer than the timeout, pause it as of its
   * last heartbeat, so time after the page closed is never counted.
   */
  private applyAutoPause(): void {
    const session = this.activeSession();
    if (session?.status !== 'running') return;
    if (this.now() - session.last_heartbeat <= HEARTBEAT_TIMEOUT_MS) return;
    this.closeSegment(session.id, session.last_heartbeat);
    this.db
      .prepare(`UPDATE sessions SET status = 'paused', auto_paused_at = last_heartbeat WHERE id = ?`)
      .run(session.id);
  }

  private activeSession(): SessionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM sessions WHERE status != 'stopped' ORDER BY id DESC LIMIT 1`)
      .get() as SessionRow | undefined;
  }

  private requireSession(status?: 'running' | 'paused'): SessionRow {
    const session = this.activeSession();
    if (!session) throw new TimerError('No session in progress');
    if (status && session.status !== status) {
      throw new TimerError(`Session is ${session.status}, expected ${status}`);
    }
    return session;
  }

  private openSegment(sessionId: number, at: number): void {
    this.db.prepare(`INSERT INTO segments (session_id, start) VALUES (?, ?)`).run(sessionId, at);
  }

  private closeSegment(sessionId: number, at: number): void {
    // MAX guards against a segment ending before it started (e.g. clock changes).
    this.db
      .prepare(`UPDATE segments SET "end" = MAX(start, ?) WHERE session_id = ? AND "end" IS NULL`)
      .run(at, sessionId);
  }

  private rateCents(): number {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'rate_cents'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : DEFAULT_RATE_CENTS;
  }

  private buildState(): TimerState {
    const now = this.now();
    const row = this.activeSession();
    let session: ActiveSession | null = null;
    if (row) {
      const seg = this.db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN "end" IS NOT NULL THEN "end" - start END), 0) AS closed_ms,
                  MAX(CASE WHEN "end" IS NULL THEN start END) AS open_start
           FROM segments WHERE session_id = ?`,
        )
        .get(row.id) as { closed_ms: number; open_start: number | null };
      session = {
        id: row.id,
        status: row.status as ActiveSession['status'],
        startedAt: row.started_at,
        closedMs: seg.closed_ms,
        segmentStart: seg.open_start,
        rateCents: row.rate_cents,
        autoPausedAt: row.auto_paused_at,
      };
    }
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    return {
      session,
      today: this.totals(startOfToday),
      lifetime: this.totals(0),
      rateCents: this.rateCents(),
    };
  }

  /** Totals over stopped sessions that started at or after `since`. */
  private totals(since: number): Totals {
    // Integer division in SQLite floors, matching earnedCents() for whole minutes.
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(active_ms), 0) AS ms,
                COALESCE(SUM((active_ms / ${MINUTE_MS}) * rate_cents), 0) AS cents
         FROM (
           SELECT s.rate_cents, COALESCE(SUM(g."end" - g.start), 0) AS active_ms
           FROM sessions s LEFT JOIN segments g ON g.session_id = s.id
           WHERE s.status = 'stopped' AND s.started_at >= ?
           GROUP BY s.id
         )`,
      )
      .get(since) as { ms: number; cents: number };
    return { ms: row.ms, cents: row.cents };
  }
}
