# Flow

A Windows desktop study timer that pays you $1 (configurable) for every whole minute of focus.

## Download

Get `Flow-Setup-<version>.exe` from the
[latest release](https://github.com/stevenliangcode/flow/releases/latest) and run it.

The installer isn't code-signed, so Windows SmartScreen will warn you once: choose
**More info → Run anyway**. Flow runs entirely on your computer; your history is stored in
`%APPDATA%\Flow\flow.db` and never leaves it.

To build the installer yourself instead (Node.js 22+):

```bash
npm install
npm run dist       # writes release/Flow-Setup-<version>.exe
```

## Features

- **Global hotkey:** `Ctrl+Alt+F` starts / pauses / resumes from any app. `Space` does the
  same while the Flow window is focused.
- **Tray icon:** green while earning, amber when paused, grey when idle. Hover for the live
  time and money; right-click for controls.
- **Auto-pause:** locking the screen, sleep, sign-out, or closing Flow pauses immediately.
- **Notifications** each time today's total crosses another $25.
- **Start Flow when I sign in** (in the window footer or tray menu) launches it quietly to
  the tray.

## How it works

- **The main process keeps the time.** Each session is a set of segments (start/end
  timestamps) in SQLite. The UI computes the live clock from those timestamps and never
  counts on its own.
- **Earnings** are `floor(active minutes) × rate`, per session. Seconds add up across
  pauses within a session; leftover seconds at Stop are dropped.
- **Crash safety:** while running, the app records a heartbeat every 15s. If Flow crashes
  or the power goes out, the session is paused as of its last heartbeat.
- **Rate changes** apply from the next session.

## Development

Running from source keeps its data in `%APPDATA%\Flow Dev`, separate from the installed
app, so you can test while your real Flow is open (the hotkey stays with the installed one).

```bash
npm start          # build and run the app without installing it
npm run dev        # hot-reloading UI (rerun after editing electron/)
npm test           # timer logic tests
npm run typecheck
npm run icon       # regenerate build/icon.png
```

### Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The [Release workflow](.github/workflows/release.yml) tests, builds the installer on
Windows, and publishes it as a GitHub Release.

### Layout

```
core/      SQLite schema and timer logic + tests
electron/  Main process (window, tray, hotkey, auto-pause, IPC), preload bridge, icon drawing
shared/    Types, earnings rule, and the bridge interface between main process and UI
web/       React UI (Vite)
```
