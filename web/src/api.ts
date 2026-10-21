import type { BridgeResult, TimerAction } from '../../shared/bridge';

async function unwrap<T>(result: Promise<BridgeResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

export type { TimerAction };

/** The Electron main process, via the preload bridge. Errors become thrown Errors. */
export const api = {
  state: () => unwrap(window.flow.state()),
  action: (action: TimerAction) => unwrap(window.flow.action(action)),
  history: () => unwrap(window.flow.history()),
  setRate: (rateCents: number) => unwrap(window.flow.setRate(rateCents)),
  launchAtLogin: () => window.flow.launchAtLogin(),
  setLaunchAtLogin: (enabled: boolean) => window.flow.setLaunchAtLogin(enabled),
  onState: window.flow.onState,
};
