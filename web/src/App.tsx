import { useCallback, useEffect, useRef, useState } from 'react';
import { MINUTE_MS, type HistoryEntry } from '../../shared/types';
import { api } from './api';
import { formatClock, formatDuration, formatMoney, formatTime } from './format';
import { History } from './History';
import { LaunchAtLoginToggle } from './LaunchAtLoginToggle';
import { RateSetting } from './RateSetting';
import { useTimer } from './useTimer';

export function App() {
  const { state, session, activeMs, sessionCents, error, busy, act, setRate } = useTimer();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [banked, setBanked] = useState<HistoryEntry | null>(null);
  const reward = useReward(session?.id ?? null, sessionCents);

  // Reload history on startup and whenever a session ends, wherever it was stopped from
  // (this window, the tray or the hotkey).
  const sessionId = state ? (session?.id ?? null) : undefined;
  const prevSessionId = useRef(sessionId);
  useEffect(() => {
    const ended = typeof prevSessionId.current === 'number' && sessionId === null;
    prevSessionId.current = sessionId;
    if (sessionId === undefined) return;
    if (sessionId !== null) setBanked(null);
    api
      .history()
      .then((latest) => {
        setHistory(latest);
        if (ended) setBanked(latest[0] ?? null);
      })
      .catch(() => {});
  }, [sessionId]);

  const status = session?.status ?? 'idle';

  const primary = useCallback(async () => {
    if (status === 'idle') await act('start');
    else if (status === 'running') await act('pause');
    else await act('resume');
  }, [status, act]);

  const stop = useCallback(() => act('stop'), [act]);

  // Space bar starts, pauses or resumes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || busy) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, button, textarea')) return;
      e.preventDefault();
      primary();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary, busy]);

  useEffect(() => {
    if (status === 'idle') document.title = 'Flow';
    else {
      const icon = status === 'running' ? '▶' : '⏸';
      document.title = `${icon} ${formatClock(activeMs)} · ${formatMoney(sessionCents)} — Flow`;
    }
  }, [status, activeMs, sessionCents]);

  if (!state) {
    return <main className="loading">{error ? `Flow couldn't load: ${error}` : 'Loading…'}</main>;
  }

  const minuteProgress = (activeMs % MINUTE_MS) / MINUTE_MS;
  const secondsToNext = Math.ceil((MINUTE_MS - (activeMs % MINUTE_MS)) / 1000);
  const todayCents = state.today.cents + sessionCents;
  const todayMs = state.today.ms + activeMs;
  const lifetimeCents = state.lifetime.cents + sessionCents;

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◐
          </span>
          Flow
        </div>
        <div className="totals">
          <div>
            <span className="label">Today</span>
            <span className="value">{formatMoney(todayCents)}</span>
            {todayMs > 0 && <span className="sub">{formatDuration(todayMs)}</span>}
          </div>
          <div>
            <span className="label">All time</span>
            <span className="value">{formatMoney(lifetimeCents)}</span>
          </div>
        </div>
      </header>

      <section className={`card timer status-${status}`}>
        {session?.autoPausedAt && (
          <div className="notice">
            Auto-paused at {formatTime(session.autoPausedAt)} while you were away. Resume when
            you're back.
          </div>
        )}
        {status === 'idle' && banked && (
          <div className="notice success">
            Banked {formatMoney(banked.earnedCents)} for {formatDuration(banked.activeMs)} of focus.
          </div>
        )}

        <div className="earned-label">
          {status === 'idle' ? 'Ready when you are' : status === 'running' ? 'Earning' : 'Paused'}
        </div>
        <div className="money-wrap">
          <div key={reward.key} className={`money ${reward.key ? 'bump' : ''}`}>
            {formatMoney(sessionCents)}
          </div>
          {reward.key > 0 && (
            <span key={`pop-${reward.key}`} className="pop">
              +{formatMoney(session?.rateCents ?? state.rateCents)}
            </span>
          )}
        </div>
        <div className="clock">{formatClock(activeMs)}</div>

        <div className="progress" aria-hidden>
          <div className="progress-fill" style={{ width: `${minuteProgress * 100}%` }} />
        </div>
        <div className="progress-label">
          {status === 'running'
            ? `Next ${formatMoney(session!.rateCents)} in ${secondsToNext}s`
            : `${formatMoney(session?.rateCents ?? state.rateCents)} for every minute of focus`}
        </div>

        <div className="controls">
          <button className="btn primary" onClick={primary} disabled={busy}>
            {status === 'idle' ? 'Start' : status === 'running' ? 'Pause' : 'Resume'}
          </button>
          {status !== 'idle' && (
            <button className="btn ghost" onClick={stop} disabled={busy}>
              Stop &amp; bank
            </button>
          )}
        </div>
        <div className="hint">
          Press <kbd>Space</kbd> to {status === 'running' ? 'pause' : status === 'paused' ? 'resume' : 'start'}
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      <History entries={history} />

      <footer className="footer">
        <RateSetting rateCents={state.rateCents} sessionActive={!!session} onSave={setRate} />
        <LaunchAtLoginToggle />
      </footer>
    </main>
  );
}

/** Bumps a key each time the session's earnings go up, to replay the reward animation. */
function useReward(sessionId: number | null, cents: number) {
  const [key, setKey] = useState(0);
  const prev = useRef({ sessionId, cents });
  useEffect(() => {
    if (prev.current.sessionId === sessionId && cents > prev.current.cents) {
      setKey((k) => k + 1);
    }
    if (sessionId === null) setKey(0);
    prev.current = { sessionId, cents };
  }, [sessionId, cents]);
  return { key };
}
