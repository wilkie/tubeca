import { createSocket } from 'dgram';

/**
 * Talking to systemd, when systemd is listening.
 *
 * A unit with `Type=notify` waits for the service to say it is ready before
 * calling it started, and one with `WatchdogSec` restarts it when the pings
 * stop. That turns "the process is alive" into "the process can still reach
 * its database and its queue", which is the failure that actually strands a
 * media server: Redis goes away, the socket stays open, nothing restarts.
 *
 * Everything here is a no-op when `NOTIFY_SOCKET` is unset, which is every
 * run outside systemd: development, tests, `docker run`.
 *
 * The protocol is a datagram of `KEY=value` lines to the socket named in
 * `NOTIFY_SOCKET`, so it needs no library. An abstract socket, which systemd
 * uses by default, is named with a leading NUL.
 */

/** Send one notification. Returns false when there is nobody to tell. */
export function notify(state: string): boolean {
  const address = process.env.NOTIFY_SOCKET;
  if (!address) return false;

  // "@" is systemd's spelling of the abstract namespace's leading NUL.
  const socketPath = address.startsWith('@') ? `\0${address.slice(1)}` : address;

  try {
    const socket = createSocket('unix_dgram' as 'udp4');
    const message = Buffer.from(state);
    (socket as unknown as {
      send: (msg: Buffer, path: string, cb: (error: Error | null) => void) => void
    }).send(message, socketPath, () => socket.close());
    return true;
  } catch {
    // A kernel without unix_dgram support, or a socket that has gone away.
    return false;
  }
}

/** Tell systemd the service is up and can be depended on. */
export function notifyReady(): void {
  notify('READY=1');
}

/** Tell systemd the service is going away on purpose. */
export function notifyStopping(): void {
  notify('STOPPING=1');
}

/**
 * How often to ping, from `WatchdogSec`. systemd sets `WATCHDOG_USEC`; half
 * of it is the conventional interval, so one missed check does not kill a
 * healthy service.
 */
export function watchdogIntervalMs(): number | null {
  const usec = Number(process.env.WATCHDOG_USEC);
  if (!Number.isFinite(usec) || usec <= 0) return null;
  return Math.max(1000, Math.floor(usec / 2000));
}

export interface WatchdogHandle {
  stop: () => void
}

/**
 * Ping systemd while `isHealthy` keeps saying yes.
 *
 * A failing check simply stops the pings: systemd decides what to do about it
 * (restart, by the unit's policy) rather than the process killing itself, and
 * a check that recovers before the deadline is never noticed.
 */
export function startWatchdog(isHealthy: () => Promise<boolean>): WatchdogHandle | null {
  const intervalMs = watchdogIntervalMs();
  if (!intervalMs || !process.env.NOTIFY_SOCKET) return null;

  const timer = setInterval(async () => {
    try {
      if (await isHealthy()) notify('WATCHDOG=1');
      else console.warn('⚠️ Health check failed; not pinging the systemd watchdog');
    } catch (error) {
      console.warn('⚠️ Health check threw; not pinging the systemd watchdog:', error);
    }
  }, intervalMs);

  // The watchdog must not be what keeps the process alive.
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
