import { useCallback, useEffect, useState } from 'react';
import { earnedCents, liveActiveMs, type TimerState } from '../../shared/types';
import { api, type TimerAction } from './api';

/**
 * Mirrors the timer state held by the main process and works out live values from its
 * timestamps. The UI never counts time on its own.
 */
export function useTimer() {
  const [state, setState] = useState<TimerState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: TimerState) => {
    setState(next);
    setError(null);
  }, []);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    api.state().then(apply).catch(fail);
    // The main process pushes every change, including ones from the tray, hotkey and lock screen.
    return api.onState(apply);
  }, [apply, fail]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const act = useCallback(
    async (action: TimerAction) => {
      setBusy(true);
      try {
        const next = await api.action(action);
        apply(next);
        return next;
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
    },
    [apply, fail],
  );

  const setRate = useCallback(
    (rateCents: number) => api.setRate(rateCents).then(apply).catch(fail),
    [apply, fail],
  );

  const session = state?.session ?? null;
  const activeMs = liveActiveMs(session, now);
  const sessionCents = session ? earnedCents(activeMs, session.rateCents) : 0;

  return { state, session, activeMs, sessionCents, error, busy, act, setRate };
}
