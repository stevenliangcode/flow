import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  type MenuItemConstructorOptions,
} from 'electron';
import { openDb } from '../core/db';
import { Timer, TimerError } from '../core/timer';
import type { BridgeResult, LaunchAtLogin, TimerAction } from '../shared/bridge';
import { earnedCents, liveActiveMs, type TimerState } from '../shared/types';
import { formatClock, formatMoney } from '../web/src/format';
import { COLORS, markPng } from './icon';

const DEV_URL = 'http://localhost:5173';
const HOTKEY = 'CommandOrControl+Alt+F';
const HOTKEY_LABEL = 'Ctrl+Alt+F';
/** The main process keeps running sessions alive; if it dies, auto-pause kicks in on next launch. */
const HEARTBEAT_MS = 15_000;
const MILESTONE_CENTS = 2500;

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

let timer: Timer;
let state: TimerState;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let lastMilestone = 0;

// Running from source (npm start / npm run dev) gets its own data folder and instance lock,
// so it never touches, or gets blocked by, the installed Flow and your real history.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Flow Dev'));

if (!app.requestSingleInstanceLock()) {
  // Flow is already open: that instance shows its window (see 'second-instance').
  app.quit();
} else {
  app.setAppUserModelId('com.flow.studytimer'); // needed for Windows notifications
  app.on('second-instance', showWindow);
  app.whenReady().then(init);
}

function init() {
  timer = new Timer(openDb(join(app.getPath('userData'), 'flow.db')));
  // A heartbeat also applies any auto-pause left over from a crash or power loss.
  publish(timer.heartbeat());
  lastMilestone = Math.floor(liveNumbers().todayCents / MILESTONE_CENTS);

  registerIpc();
  watchPower();
  createTray();
  if (!globalShortcut.register(HOTKEY, togglePrimary)) {
    console.warn(`Could not register ${HOTKEY}; another app is using it.`);
  }

  setInterval(() => publish(timer.heartbeat()), HEARTBEAT_MS);
  setInterval(tick, 1000);

  Menu.setApplicationMenu(null);
  if (!startHidden) createWindow();
}

// ---- timer state -----------------------------------------------------------

/** Records the latest state and pushes it to the page and the tray. */
function publish(next: TimerState) {
  const statusChanged = next.session?.status !== state?.session?.status;
  state = next;
  win?.webContents.send('flow:state', next);
  if (statusChanged) updateTrayMenu();
  tick();
}

function safely<T>(fn: () => T): BridgeResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof TimerError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: 'Something went wrong' };
  }
}

function runAction(action: TimerAction): BridgeResult<TimerState> {
  const result = safely(() => {
    switch (action) {
      case 'start':
        return timer.start();
      case 'pause':
        return timer.pause();
      case 'resume':
        return timer.resume();
      case 'stop':
        return timer.stop();
      default:
        throw new TimerError(`Unknown action: ${String(action)}`);
    }
  });
  if (result.ok) publish(result.value);
  return result;
}

function togglePrimary() {
  const status = state.session?.status;
  runAction(status === 'running' ? 'pause' : status === 'paused' ? 'resume' : 'start');
}

function liveNumbers() {
  const activeMs = liveActiveMs(state.session, Date.now());
  const sessionCents = state.session ? earnedCents(activeMs, state.session.rateCents) : 0;
  return { activeMs, sessionCents, todayCents: state.today.cents + sessionCents };
}

/** Runs every second: tray tooltip and milestone notifications. */
function tick() {
  if (!state) return;
  const { activeMs, sessionCents, todayCents } = liveNumbers();
  tray?.setToolTip(trayLabel(activeMs, sessionCents));

  const milestone = Math.floor(todayCents / MILESTONE_CENTS);
  if (milestone > lastMilestone && Notification.isSupported()) {
    new Notification({
      title: `You've earned ${formatMoney(milestone * MILESTONE_CENTS)} today`,
      body: 'Nice focus. Keep it flowing.',
      icon: nativeImage.createFromBuffer(markPng(64, { color: COLORS.running, background: COLORS.background })),
    }).show();
  }
  lastMilestone = milestone; // also drops back at midnight when "today" resets
}

// ---- window ----------------------------------------------------------------

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 520,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Flow',
    backgroundColor: dark ? '#111311' : '#f4f2ec',
    icon: nativeImage.createFromBuffer(markPng(256, { color: COLORS.running, background: COLORS.background })),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  win.on('session-end', autoPause); // Windows sign-out or shutdown
  // The page never needs to open or navigate to anything else.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (isDev) loadDevServer(win);
  else win.loadFile(join(__dirname, '..', 'web', 'dist', 'index.html'));
}

/** Vite may still be starting when Electron launches in dev, so retry for a while. */
async function loadDevServer(target: BrowserWindow, attempt = 0) {
  try {
    await target.loadURL(DEV_URL);
  } catch {
    if (attempt < 30 && !target.isDestroyed()) {
      setTimeout(() => loadDevServer(target, attempt + 1), 500);
    }
  }
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- tray ------------------------------------------------------------------

function trayImage(status: 'running' | 'paused' | 'idle') {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.5, 2]) {
    image.addRepresentation({
      scaleFactor,
      buffer: markPng(Math.round(16 * scaleFactor), { color: COLORS[status] }),
    });
  }
  return image;
}

function createTray() {
  tray = new Tray(trayImage('idle'));
  tray.on('click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const status = state.session?.status ?? 'idle';
  tray.setImage(trayImage(status));

  const primaryLabel = status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start';
  const login = launchAtLogin();
  const template: MenuItemConstructorOptions[] = [
    { label: 'Show Flow', click: showWindow },
    { type: 'separator' },
    { label: `${primaryLabel}\t${HOTKEY_LABEL}`, click: togglePrimary },
    { label: 'Stop & bank', enabled: status !== 'idle', click: () => runAction('stop') },
    { type: 'separator' },
    {
      label: 'Start Flow when I sign in',
      type: 'checkbox',
      checked: login.enabled,
      enabled: login.available,
      click: (item) => setLaunchAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit Flow', role: 'quit' },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function trayLabel(activeMs: number, sessionCents: number) {
  const status = state.session?.status;
  if (!status) return `Flow · ${formatMoney(state.today.cents)} today`;
  const icon = status === 'running' ? '▶' : '⏸';
  return `Flow · ${icon} ${formatClock(activeMs)} · ${formatMoney(sessionCents)}`;
}

// ---- launch at login -------------------------------------------------------

function launchAtLogin(): LaunchAtLogin {
  // Unpackaged, the registered program would be the bare Electron binary, not Flow.
  if (!app.isPackaged) return { available: false, enabled: false };
  return { available: true, enabled: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin };
}

function setLaunchAtLogin(enabled: boolean): LaunchAtLogin {
  if (app.isPackaged) {
    // Starts quietly in the tray; Ctrl+Alt+F or the tray icon gets going from there.
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  }
  updateTrayMenu();
  return launchAtLogin();
}

// ---- IPC, power, lifecycle ---------------------------------------------------

function registerIpc() {
  ipcMain.handle('flow:getState', () => safely(() => timer.state()));
  ipcMain.handle('flow:action', (_e, action: TimerAction) => runAction(action));
  ipcMain.handle('flow:history', () => safely(() => timer.history()));
  ipcMain.handle('flow:setRate', (_e, rateCents: number) => {
    const result = safely(() => timer.setRate(rateCents));
    if (result.ok) publish(result.value);
    return result;
  });
  ipcMain.handle('flow:launchAtLogin', () => launchAtLogin());
  ipcMain.handle('flow:setLaunchAtLogin', (_e, enabled: boolean) => setLaunchAtLogin(enabled));
}

function autoPause() {
  publish(timer.autoPause());
}

/** Pause the moment you step away: screen locked, computer asleep, or Flow quitting. */
function watchPower() {
  powerMonitor.on('lock-screen', autoPause);
  powerMonitor.on('suspend', autoPause);
  powerMonitor.on('shutdown', autoPause);
  app.on('before-quit', autoPause);
}

app.on('window-all-closed', () => app.quit()); // closing the window quits Flow (and pauses)
app.on('will-quit', () => globalShortcut.unregisterAll());

