import dns from 'node:dns'
import { Agent } from 'undici'

/**
 * The provider answered, and does not have this.
 *
 * A plugin's by-id methods report a miss by returning `null`, which the worker
 * takes as "the entry has gone" and records as a no-match. A timeout or a 5xx
 * is not that: it means try again later, and must reach the worker as a thrown
 * error so it can be retried. Only a 404 becomes this.
 */
export class ProviderNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderNotFoundError'
  }
}

/** True for the error above, however it crossed a package boundary. */
export function isProviderNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'ProviderNotFoundError'
}

/**
 * A pooled HTTP dispatcher for scraper plugins, with DNS that stays off the
 * libuv threadpool.
 *
 * `dns.lookup` (getaddrinfo) runs on libuv's threadpool. Under WSL2 the file
 * watcher polls SMB-mounted libraries, which blocks that pool with slow CIFS
 * `stat` calls — measured at 30-60s, well past a request timeout, so provider
 * calls aborted while image downloads (which have no timeout) kept working.
 * `dns.resolve4` uses c-ares, which runs on the event loop instead, so DNS is
 * immune to that starvation. A short TTL cache avoids re-querying on every
 * reconnect, and pooled connections mean reconnects are rare in the first
 * place.
 *
 * IPv4 only: WSL2's NAT typically has no working IPv6 route.
 */

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void

const DNS_TTL_MS = 5 * 60_000

/** Exported for tests; a process shares one cache across plugins. */
export const dnsCache = new Map<string, { address: string; expires: number }>()

/** How the resolver reports itself, so a slow lookup names the plugin that hit it. */
export function createCachedLookup(label: string) {
  return function cachedLookup(
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback
  ): void {
    const respond = (address: string) =>
      options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)

    const cached = dnsCache.get(hostname)
    if (cached && cached.expires > Date.now()) {
      respond(cached.address)
      return
    }

    const start = performance.now()
    dns.resolve4(hostname, (err, addresses) => {
      const ms = performance.now() - start
      if (ms > 1000) {
        // Diagnostic: c-ares should not be slow; if this fires, DNS itself is
        // the problem rather than the threadpool.
        console.warn(`⚠️  ${label} DNS resolve for ${hostname} took ${Math.round(ms)}ms`)
      }
      if (err || !addresses || addresses.length === 0) {
        // Fall back to getaddrinfo, e.g. for /etc/hosts entries c-ares cannot see.
        dns.lookup(hostname, { family: 4 }, (lookupError, address) => {
          if (lookupError) {
            callback(lookupError, '', 0)
            return
          }
          dnsCache.set(hostname, { address, expires: Date.now() + DNS_TTL_MS })
          respond(address)
        })
        return
      }
      dnsCache.set(hostname, { address: addresses[0], expires: Date.now() + DNS_TTL_MS })
      respond(addresses[0])
    })
  }
}

/**
 * One pooled agent per plugin, keeping connections warm so TCP and TLS setup
 * happens rarely. The backend also raises `UV_THREADPOOL_SIZE`; see its
 * package scripts.
 */
export function createScraperAgent(label: string): Agent {
  return new Agent({
    connect: {
      timeout: 10000,
      lookup: createCachedLookup(label),
    },
    bodyTimeout: 15000,
    headersTimeout: 15000,
    keepAliveTimeout: 10000,
    keepAliveMaxTimeout: 30000,
  })
}
