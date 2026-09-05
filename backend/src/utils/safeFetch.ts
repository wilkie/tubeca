import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * Outbound fetches that a request body can steer.
 *
 * `POST /api/images/download` takes a URL from the client and the scrape
 * workers take one from whatever a provider returned, so in both cases the
 * server is asked to make a request on somebody else's behalf. Unguarded that
 * is server-side request forgery: the caller cannot see the response body
 * unless it happens to be an image, but a status code and a timing difference
 * are enough to map what is listening on localhost, and this server shares a
 * machine with Redis and with its own API.
 *
 * The guard is at the connect layer rather than in front of it. Checking the
 * hostname before calling `fetch` leaves two holes — a redirect to an internal
 * address, and a name that resolves publicly for the check and privately for
 * the connection — and both are closed by refusing the address that the socket
 * is actually about to be opened to.
 */

/**
 * Every refusal says this, and `refusalWithin` looks for it.
 *
 * Undici wraps a connect failure in its own `TypeError`, and crossing a module
 * realm (Jest's, for one) can flatten the cause to a plain `Error` whose name
 * and code are gone but whose message survives. A marker in the text is the one
 * part that always makes it through.
 */
export const REFUSAL_MARKER = 'this server will not request';

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

/** Only these two reach the network at all; `file:` and the rest are refused. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

interface Range {
  /** Network address as bytes */
  network: number[]
  /** Leading bits that must match */
  bits: number
  why: string
}

/** IPv4 ranges that are not somewhere on the public internet. */
const BLOCKED_V4: Range[] = [
  { network: [0, 0, 0, 0], bits: 8, why: 'this network' },
  { network: [10, 0, 0, 0], bits: 8, why: 'private' },
  { network: [100, 64, 0, 0], bits: 10, why: 'carrier-grade NAT' },
  { network: [127, 0, 0, 0], bits: 8, why: 'loopback' },
  { network: [169, 254, 0, 0], bits: 16, why: 'link-local' },
  { network: [172, 16, 0, 0], bits: 12, why: 'private' },
  { network: [192, 0, 0, 0], bits: 24, why: 'IETF protocol assignments' },
  { network: [192, 0, 2, 0], bits: 24, why: 'documentation' },
  { network: [192, 168, 0, 0], bits: 16, why: 'private' },
  { network: [198, 18, 0, 0], bits: 15, why: 'benchmarking' },
  { network: [198, 51, 100, 0], bits: 24, why: 'documentation' },
  { network: [203, 0, 113, 0], bits: 24, why: 'documentation' },
  { network: [224, 0, 0, 0], bits: 4, why: 'multicast' },
  { network: [240, 0, 0, 0], bits: 4, why: 'reserved' },
];

function v6(...groups: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const group = groups[i] ?? 0;
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

const BLOCKED_V6: Range[] = [
  { network: v6(), bits: 128, why: 'unspecified' },
  { network: v6(0, 0, 0, 0, 0, 0, 0, 1), bits: 128, why: 'loopback' },
  { network: v6(0xfc00), bits: 7, why: 'unique local' },
  { network: v6(0xfe80), bits: 10, why: 'link-local' },
  { network: v6(0xff00), bits: 8, why: 'multicast' },
  { network: v6(0x0100), bits: 64, why: 'discard-only' },
  { network: v6(0x2001, 0x0db8), bits: 32, why: 'documentation' },
];

/** Expand any accepted IP text to its bytes: four for IPv4, sixteen for IPv6. */
export function addressBytes(address: string): number[] | null {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
      ? parts
      : null;
  }
  if (version !== 6) return null;

  // A zone index ("fe80::1%eth0") says nothing about which network this is.
  const plain = address.split('%')[0];

  // The last two groups may be written as dotted-quad, as in ::ffff:127.0.0.1.
  let head = plain;
  let tail: number[] = [];
  const lastColon = plain.lastIndexOf(':');
  const suffix = plain.slice(lastColon + 1);
  if (suffix.includes('.')) {
    const embedded = addressBytes(suffix);
    if (!embedded) return null;
    tail = embedded;
    head = plain.slice(0, lastColon + 1) + '0:0';
  }

  const [before, after] = head.split('::');
  const toGroups = (text: string) =>
    text.length === 0 ? [] : text.split(':').map((group) => parseInt(group, 16));
  const left = toGroups(before ?? '');
  const right = after === undefined ? [] : toGroups(after);
  if ([...left, ...right].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }

  // Eight groups either way: an embedded IPv4 was rewritten as two of them
  // above and is spliced back in below.
  const missing = 8 - left.length - right.length;
  if (after === undefined && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];

  const bytes: number[] = [];
  for (const group of groups) bytes.push((group >> 8) & 0xff, group & 0xff);
  if (tail.length > 0) bytes.splice(12, 4, ...tail);
  return bytes.length === 16 ? bytes : null;
}

function inRange(bytes: number[], range: Range): boolean {
  if (bytes.length !== range.network.length) return false;
  let bitsLeft = range.bits;
  for (let i = 0; i < bytes.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (range.network[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

/**
 * Whether an address is somewhere this server must not be made to reach: its
 * own loopback, the private networks around it, or the link-local range that
 * holds a cloud provider's metadata service.
 *
 * An unparseable address counts as blocked. Anything the guard cannot read, it
 * cannot vouch for.
 */
export function isBlockedAddress(address: string): boolean {
  const bytes = addressBytes(address);
  if (!bytes) return true;

  if (bytes.length === 4) return BLOCKED_V4.some((range) => inRange(bytes, range));

  // An IPv4 address wearing an IPv6 hat — ::ffff:127.0.0.1 reaches loopback
  // just as 127.0.0.1 does — so judge it as the IPv4 address it is.
  const mapped = v6(0, 0, 0, 0, 0, 0xffff);
  const nat64 = v6(0x0064, 0xff9b);
  if (inRange(bytes, { network: mapped, bits: 96, why: 'mapped' }) ||
      inRange(bytes, { network: nat64, bits: 96, why: 'NAT64' })) {
    return BLOCKED_V4.some((range) => inRange(bytes.slice(12), range));
  }

  return BLOCKED_V6.some((range) => inRange(bytes, range));
}

/** An `Error` carrying a `code`, the shape Node's own callbacks hand back. */
export interface ErrorWithCode extends Error {
  code?: string
}

type LookupCallback = (
  error: ErrorWithCode | null,
  address: string | { address: string; family: number }[],
  family?: number
) => void;

/**
 * A DNS lookup that hands back only public addresses.
 *
 * Undici calls this to decide where to open the socket, so what it returns is
 * where the request actually goes — for the first request and for every
 * redirect it follows. A name that resolves to both a public and a private
 * address keeps the public one; a name with nothing public left fails.
 */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: LookupCallback
): void {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '');
      return;
    }
    const allowed = addresses.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) {
      const blocked = new BlockedAddressError(
        `${hostname} resolves only to addresses ${REFUSAL_MARKER} (${addresses
          .map((a) => a.address)
          .join(', ')})`
      ) as ErrorWithCode;
      blocked.code = 'EBLOCKED';
      callback(blocked, '');
      return;
    }
    if (options.all) {
      callback(null, allowed);
      return;
    }
    callback(null, allowed[0].address, allowed[0].family);
  });
}

/**
 * The dispatcher for anything fetched at a caller's direction. Connections are
 * pooled the way the default one pools them; the difference is where they are
 * allowed to go.
 */
export const publicOnlyAgent = new Agent({
  connect: {
    // Undici's own type for this is narrower than what Node's dns.lookup
    // accepts; the shapes agree at runtime.
    lookup: publicOnlyLookup as never,
    timeout: 10_000,
  },
});

/** Why a URL was refused before any request was made, or null when it is fine. */
export function urlRefusalReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Not a URL';
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return `Only http and https URLs can be fetched, not ${parsed.protocol}`;
  }
  // An IP literal never goes near a resolver, so judge it here as well. The
  // dispatcher's lookup would catch it too; this gives a better message.
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isBlockedAddress(literal)) {
    return `${parsed.hostname} is not an address this server will request`;
  }
  return null;
}

/**
 * Find a refusal from the lookup inside whatever `fetch` threw.
 *
 * Undici reports a connect failure as a flat `TypeError: fetch failed` with the
 * real reason in `cause`, or an `AggregateError` when every address failed. The
 * reason is the useful part — "this is not an address I will request" rather
 * than "something went wrong" — so it is dug out and thrown in its place.
 */
function refusalWithin(error: unknown, depth = 0): BlockedAddressError | null {
  if (depth > 5 || !error || typeof error !== 'object') return null;
  const candidate = error as { name?: string; code?: string; message?: string; cause?: unknown; errors?: unknown[] };
  const message = candidate.message ?? '';
  if (
    candidate.name === 'BlockedAddressError' ||
    candidate.code === 'EBLOCKED' ||
    message.includes(REFUSAL_MARKER)
  ) {
    // A flattened cause carries the class name in the text; drop it so the
    // message reads as one sentence rather than two.
    return new BlockedAddressError(message.replace(/^BlockedAddressError:\s*/, '') || 'Address refused');
  }
  for (const nested of [candidate.cause, ...(candidate.errors ?? [])]) {
    const found = refusalWithin(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * `fetch`, restricted to public http(s) addresses. Use this for any URL that
 * came from outside — a request body, or a scraper's response — rather than
 * the global one.
 */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export async function safeFetch(url: string, init: FetchInit = {}): Promise<Response> {
  const refusal = urlRefusalReason(url);
  if (refusal) throw new BlockedAddressError(refusal);

  try {
    return await fetch(url, {
      ...init,
      // Node's fetch is undici's and takes a dispatcher; the DOM types do not
      // describe it.
      dispatcher: publicOnlyAgent,
    } as FetchInit);
  } catch (error) {
    const refusal = refusalWithin(error);
    if (refusal) throw refusal;
    throw error;
  }
}
