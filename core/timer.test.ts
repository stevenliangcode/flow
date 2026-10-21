import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { openDb } from './db';
import { HEARTBEAT_TIMEOUT_MS, Timer, TimerError } from './timer';

const SEC = 1000;
const MIN = 60 * SEC;

let clock: number;
let timer: Timer;

function advance(ms: number) {
  clock += ms;
}

/** Advances the clock with the page open, sending heartbeats like the client does. */
function study(ms: number) {
  const end = clock + ms;
  while (clock + 15 * SEC < end) {
    advance(15 * SEC);
    timer.heartbeat();
  }
  clock = end;
}

beforeEach(() => {
  clock = new Date(2026, 9, 21, 9, 0, 0).getTime();
  timer = new Timer(openDb(':memory:'), () => clock);
});

describe('earnings', () => {
  test('pays $1 per whole minute', () => {
    timer.start();
    study(5 * MIN + 59 * SEC);
    const state = timer.stop();
    assert.equal(state.session, null);
    assert.deepEqual(state.lifetime, { ms: 5 * MIN + 59 * SEC, cents: 500 });
  });

  test('partial minutes add up across pauses within a session', () => {
    timer.start();
    study(40 * SEC);
    timer.pause();
    advance(10 * MIN); // paused time never counts
    timer.resume();
    study(20 * SEC);
    assert.equal(timer.stop().lifetime.cents, 100);
  });

  test('leftover seconds do not carry into the next session', () => {
    timer.start();
    study(30 * SEC);
    timer.stop();
    timer.start();
    study(30 * SEC);
    assert.equal(timer.stop().lifetime.cents, 0);
  });

  test('rate changes apply to the next session, not the current one', () => {
    timer.start();
    timer.setRate(50);
    study(2 * MIN);
    timer.stop();
    timer.start();
    study(2 * MIN);
    assert.equal(timer.stop().lifetime.cents, 200 + 100);
  });

  test('today excludes sessions from previous days', () => {
    timer.start();
    study(3 * MIN);
    timer.stop();
    advance(24 * 60 * MIN);
    timer.start();
    study(MIN);
    const state = timer.stop();
    assert.equal(state.today.cents, 100);
    assert.equal(state.lifetime.cents, 400);
  });
});

describe('state', () => {
  test('reports closed time and the open segment while running', () => {
    timer.start();
    study(MIN);
    timer.pause();
    advance(MIN);
    timer.resume();
    const { session } = timer.state();
    assert.equal(session?.status, 'running');
    assert.equal(session?.closedMs, MIN);
    assert.equal(session?.segmentStart, clock);
  });

  test('history lists stopped sessions newest first', () => {
    timer.start();
    study(2 * MIN);
    timer.stop();
    advance(MIN);
    timer.start();
    study(MIN);
    timer.stop();
    const history = timer.history();
    assert.deepEqual(
      history.map((h) => h.earnedCents),
      [100, 200],
    );
  });
});

describe('invalid transitions', () => {
  test('rejects actions that do not match the current status', () => {
    assert.throws(() => timer.pause(), TimerError);
    assert.throws(() => timer.stop(), TimerError);
    timer.start();
    assert.throws(() => timer.start(), TimerError);
    assert.throws(() => timer.resume(), TimerError);
  });

  test('rejects bad rates', () => {
    assert.throws(() => timer.setRate(0), TimerError);
    assert.throws(() => timer.setRate(1.5), TimerError);
  });
});

describe('auto-pause', () => {
  test('heartbeats keep a session running', () => {
    timer.start();
    for (let i = 0; i < 20; i++) {
      advance(15 * SEC);
      timer.heartbeat();
    }
    assert.equal(timer.state().session?.status, 'running');
  });

  test('pauses at the last heartbeat once heartbeats stop', () => {
    timer.start();
    study(3 * MIN);
    timer.heartbeat();
    const lastBeat = clock;
    advance(2 * 60 * MIN); // browser closed for two hours
    const { session } = timer.state();
    assert.equal(session?.status, 'paused');
    assert.equal(session?.autoPausedAt, lastBeat);
    assert.equal(session?.closedMs, 3 * MIN);
  });

  test('does not pause within the timeout', () => {
    timer.start();
    advance(HEARTBEAT_TIMEOUT_MS);
    assert.equal(timer.state().session?.status, 'running');
  });

  test('a late heartbeat does not revive an auto-paused session', () => {
    timer.start();
    advance(HEARTBEAT_TIMEOUT_MS + 1);
    assert.equal(timer.heartbeat().session?.status, 'paused');
  });

  test('autoPause stops the clock immediately and marks the session', () => {
    timer.start();
    study(2 * MIN + 10 * SEC);
    const { session } = timer.autoPause();
    assert.equal(session?.status, 'paused');
    assert.equal(session?.autoPausedAt, clock);
    assert.equal(session?.closedMs, 2 * MIN + 10 * SEC);
    assert.equal(timer.autoPause().session?.status, 'paused'); // no-op when not running
  });

  test('resume clears the auto-pause marker and earnings continue', () => {
    timer.start();
    study(MIN);
    timer.heartbeat();
    advance(HEARTBEAT_TIMEOUT_MS + 1);
    timer.resume();
    assert.equal(timer.state().session?.autoPausedAt, null);
    study(MIN);
    assert.equal(timer.stop().lifetime.cents, 200);
  });
});
