// The API the preload script exposes to the UI as `window.flow`.
import type { HistoryEntry, TimerState } from './types';

export type TimerAction = 'start' | 'pause' | 'resume' | 'stop';

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LaunchAtLogin {
  /** False when running unpackaged (npm start), where there is no installed app to launch. */
  available: boolean;
  enabled: boolean;
}

export interface FlowBridge {
  state(): Promise<BridgeResult<TimerState>>;
  action(action: TimerAction): Promise<BridgeResult<TimerState>>;
  history(): Promise<BridgeResult<HistoryEntry[]>>;
  setRate(rateCents: number): Promise<BridgeResult<TimerState>>;
  launchAtLogin(): Promise<LaunchAtLogin>;
  setLaunchAtLogin(enabled: boolean): Promise<LaunchAtLogin>;
  /** Every state change, including ones made outside the window (tray, hotkey, lock screen). */
  onState(listener: (state: TimerState) => void): () => void;
}

declare global {
  interface Window {
    flow: FlowBridge;
  }
}
