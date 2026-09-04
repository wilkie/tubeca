import { notify, watchdogIntervalMs, startWatchdog } from '../systemd';

describe('systemd notifications', () => {
  const originalSocket = process.env.NOTIFY_SOCKET;
  const originalUsec = process.env.WATCHDOG_USEC;

  afterEach(() => {
    if (originalSocket === undefined) delete process.env.NOTIFY_SOCKET;
    else process.env.NOTIFY_SOCKET = originalSocket;
    if (originalUsec === undefined) delete process.env.WATCHDOG_USEC;
    else process.env.WATCHDOG_USEC = originalUsec;
  });

  it('does nothing when nothing is listening', () => {
    delete process.env.NOTIFY_SOCKET;

    expect(notify('READY=1')).toBe(false);
  });

  it('does not throw when the socket cannot be opened', () => {
    process.env.NOTIFY_SOCKET = '/nonexistent/tubeca-notify.sock';

    expect(() => notify('READY=1')).not.toThrow();
  });
});

describe('watchdogIntervalMs', () => {
  const original = process.env.WATCHDOG_USEC;
  afterEach(() => {
    if (original === undefined) delete process.env.WATCHDOG_USEC;
    else process.env.WATCHDOG_USEC = original;
  });

  it('pings at half the deadline, so one slow check is survivable', () => {
    process.env.WATCHDOG_USEC = '30000000'; // 30s
    expect(watchdogIntervalMs()).toBe(15000);
  });

  it('never pings faster than once a second', () => {
    process.env.WATCHDOG_USEC = '100';
    expect(watchdogIntervalMs()).toBe(1000);
  });

  it('is off without a deadline', () => {
    delete process.env.WATCHDOG_USEC;
    expect(watchdogIntervalMs()).toBeNull();

    process.env.WATCHDOG_USEC = 'not a number';
    expect(watchdogIntervalMs()).toBeNull();
  });
});

describe('startWatchdog', () => {
  it('does not start outside systemd', () => {
    delete process.env.NOTIFY_SOCKET;
    process.env.WATCHDOG_USEC = '30000000';

    expect(startWatchdog(async () => true)).toBeNull();
  });

  it('does not start without a deadline', () => {
    process.env.NOTIFY_SOCKET = '/tmp/whatever.sock';
    delete process.env.WATCHDOG_USEC;

    expect(startWatchdog(async () => true)).toBeNull();
  });
});
