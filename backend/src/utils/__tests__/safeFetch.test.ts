import { jest } from '@jest/globals';
import type { ErrorWithCode } from '../safeFetch';
import {
  addressBytes,
  REFUSAL_MARKER,
  BlockedAddressError,
  isBlockedAddress,
  publicOnlyLookup,
  safeFetch,
  urlRefusalReason,
} from '../safeFetch';

describe('addressBytes', () => {
  it('reads a dotted quad', () => {
    expect(addressBytes('192.0.2.1')).toEqual([192, 0, 2, 1]);
    expect(addressBytes('255.255.255.255')).toEqual([255, 255, 255, 255]);
  });

  it('expands the compressed form of an IPv6 address', () => {
    expect(addressBytes('::')).toEqual(Array(16).fill(0));
    expect(addressBytes('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(addressBytes('fe80::1')).toEqual([0xfe, 0x80, ...Array(13).fill(0), 1]);
    expect(addressBytes('2001:db8::')).toEqual([0x20, 0x01, 0x0d, 0xb8, ...Array(12).fill(0)]);
  });

  it('reads a fully written IPv6 address', () => {
    expect(addressBytes('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('reads an IPv4 address embedded in an IPv6 one', () => {
    expect(addressBytes('::ffff:127.0.0.1')).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ]);
    expect(addressBytes('64:ff9b::192.0.2.33')).toEqual([
      0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, 192, 0, 2, 33,
    ]);
  });

  it('ignores a zone index, which says nothing about the network', () => {
    expect(addressBytes('fe80::1%eth0')).toEqual(addressBytes('fe80::1'));
  });

  it('refuses anything that is not an address', () => {
    for (const text of ['', 'example.com', '1.2.3', '1.2.3.4.5', '999.0.0.1', 'gggg::1', '::1::2']) {
      expect(addressBytes(text)).toBeNull();
    }
  });
});

describe('isBlockedAddress', () => {
  it('lets a public address through', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it('refuses loopback and the private networks', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '0.0.0.0',
      '100.64.0.1',
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it('refuses the link-local range that holds cloud metadata', () => {
    // The address every SSRF write-up reaches for first.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
  });

  it('keeps the neighbours of a blocked range', () => {
    // 172.16/12 ends at 172.31.255.255, and 100.64/10 at 100.127.255.255.
    expect(isBlockedAddress('172.15.255.255')).toBe(false);
    expect(isBlockedAddress('172.32.0.0')).toBe(false);
    expect(isBlockedAddress('100.63.255.255')).toBe(false);
    expect(isBlockedAddress('100.128.0.0')).toBe(false);
    expect(isBlockedAddress('11.0.0.1')).toBe(false);
    expect(isBlockedAddress('126.255.255.255')).toBe(false);
    expect(isBlockedAddress('128.0.0.1')).toBe(false);
  });

  it('refuses multicast and the reserved top of the range', () => {
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('239.255.255.255')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
    expect(isBlockedAddress('223.255.255.255')).toBe(false);
  });

  it('refuses the IPv6 equivalents', () => {
    for (const address of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it('sees through an IPv4 address wearing an IPv6 hat', () => {
    // ::ffff:127.0.0.1 reaches loopback exactly as 127.0.0.1 does.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('64:ff9b::127.0.0.1')).toBe(true);
  });

  it('treats anything it cannot read as blocked', () => {
    // The guard vouches for what it understands and nothing else.
    expect(isBlockedAddress('not an address')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('urlRefusalReason', () => {
  it('accepts an ordinary http and https URL', () => {
    expect(urlRefusalReason('https://image.tmdb.org/t/p/w500/x.jpg')).toBeNull();
    expect(urlRefusalReason('http://example.com/a.png')).toBeNull();
  });

  it('refuses a scheme that is not the web', () => {
    expect(urlRefusalReason('file:///etc/passwd')).toMatch(/http and https/);
    expect(urlRefusalReason('ftp://example.com/x.png')).toMatch(/http and https/);
    expect(urlRefusalReason('data:image/png;base64,AAAA')).toMatch(/http and https/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(urlRefusalReason('/etc/passwd')).toBe('Not a URL');
    expect(urlRefusalReason('')).toBe('Not a URL');
  });

  it('refuses an address literal that points inside', () => {
    expect(urlRefusalReason('http://127.0.0.1:6379/')).toMatch(/not an address this server will request/);
    expect(urlRefusalReason('http://169.254.169.254/latest/meta-data/')).toMatch(/not an address this server will request/);
    expect(urlRefusalReason('http://[::1]:3000/api/users')).toMatch(/not an address this server will request/);
    expect(urlRefusalReason('http://192.168.0.1/')).toMatch(/not an address this server will request/);
  });

  it('allows a public address literal', () => {
    expect(urlRefusalReason('http://8.8.8.8/x.png')).toBeNull();
  });
});

describe('publicOnlyLookup', () => {
  /** Run the lookup for a name and report what it did. */
  function resolve(hostname: string, options: { all?: boolean } = {}) {
    return new Promise<{ error: Error | null; addresses: unknown }>((done) => {
      publicOnlyLookup(hostname, options, (error, addresses) => done({ error, addresses }));
    });
  }

  it('hands back a loopback name as an error rather than an address', async () => {
    // "localhost" is the shortest way to ask this server about itself.
    const { error } = await resolve('localhost');

    expect(error).toBeInstanceOf(BlockedAddressError);
    expect((error as ErrorWithCode).code).toBe('EBLOCKED');
  });

  it('names what it refused, so a failure can be understood', async () => {
    const { error } = await resolve('localhost');

    expect(error?.message).toMatch(/localhost resolves only to addresses/);
  });

  it('passes a name that does not resolve straight through', async () => {
    const { error } = await resolve('this-name-does-not-exist.invalid');

    // A DNS failure is a DNS failure, not a refusal.
    expect(error).toBeTruthy();
    expect(error).not.toBeInstanceOf(BlockedAddressError);
  });
});

describe('safeFetch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('refuses before making any request at all', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(safeFetch('http://127.0.0.1/')).rejects.toBeInstanceOf(BlockedAddressError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an allowed URL with the dispatcher that pins where it can go', async () => {
    const fetchMock = jest.fn(async () => new Response('ok'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await safeFetch('https://example.com/a.png', { signal: AbortSignal.timeout(1000) });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('https://example.com/a.png');
    expect(init.dispatcher).toBeDefined();
    // Whatever the caller passed is kept.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('a refusal buried in what fetch threw', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Make fetch fail the way undici does, with `reason` as the cause. */
  function failsWith(reason: unknown) {
    global.fetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: reason });
    }) as unknown as typeof fetch;
  }

  it('reports the reason rather than "fetch failed"', async () => {
    failsWith(new BlockedAddressError(`nope resolves only to addresses ${REFUSAL_MARKER} (10.0.0.1)`));

    await expect(safeFetch('https://nope.example/a.png')).rejects.toThrow(/10\.0\.0\.1/);
  });

  it('finds it even when the cause was flattened to a plain Error', async () => {
    // Crossing a module realm loses the name and the code but keeps the text.
    failsWith(new Error(`BlockedAddressError: nope resolves only to addresses ${REFUSAL_MARKER} (10.0.0.1)`));

    const error = await safeFetch('https://nope.example/a.png').catch((e) => e);

    expect(error).toBeInstanceOf(BlockedAddressError);
    // Read as one sentence, not two.
    expect(error.message).not.toContain('BlockedAddressError:');
  });

  it('finds it inside an AggregateError, which is how every address failing looks', async () => {
    const aggregate = new AggregateError([
      new Error('ECONNREFUSED'),
      new Error(`nope resolves only to addresses ${REFUSAL_MARKER} (::1)`),
    ]);
    failsWith(aggregate);

    await expect(safeFetch('https://nope.example/a.png')).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('leaves an ordinary network failure as it was', async () => {
    failsWith(new Error('ECONNRESET'));

    const error = await safeFetch('https://nope.example/a.png').catch((e) => e);

    expect(error).not.toBeInstanceOf(BlockedAddressError);
    expect(error.message).toBe('fetch failed');
  });
});
