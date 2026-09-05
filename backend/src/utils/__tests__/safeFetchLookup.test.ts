import { jest } from '@jest/globals';

// What the guard does with a resolver's answer is the whole of it, so the
// resolver is the thing to control. The sibling file covers the real one.
type LookupEntry = { address: string; family: number };
const lookupMock = jest.fn<
  (
    hostname: string,
    options: unknown,
    callback: (error: (Error & { code?: string }) | null, addresses: LookupEntry[]) => void
  ) => void
>();

jest.unstable_mockModule('node:dns', () => ({
  lookup: lookupMock,
}));

const { publicOnlyLookup, BlockedAddressError } = await import('../safeFetch');

/** Make the resolver answer with these addresses for any name. */
function resolvesTo(...addresses: string[]) {
  lookupMock.mockImplementation((_hostname, _options, callback) => {
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    );
  });
}

function lookup(hostname: string, options: { all?: boolean } = {}) {
  return new Promise<{ error: Error | null; addresses: unknown; family?: number }>((done) => {
    publicOnlyLookup(hostname, options, (error, addresses, family) =>
      done({ error, addresses, family })
    );
  });
}

beforeEach(() => jest.clearAllMocks());

describe('publicOnlyLookup with a controlled resolver', () => {
  it('answers with one address when that is what was asked for', async () => {
    resolvesTo('93.184.216.34');

    const { error, addresses, family } = await lookup('example.com');

    expect(error).toBeNull();
    expect(addresses).toBe('93.184.216.34');
    expect(family).toBe(4);
  });

  it('answers with the list when the caller asked for all of them', async () => {
    resolvesTo('93.184.216.34', '2606:2800:220:1::1');

    const { error, addresses } = await lookup('example.com', { all: true });

    expect(error).toBeNull();
    expect(addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('keeps the public addresses of a name that also has private ones', async () => {
    // A split-horizon name, or an attacker's record with both.
    resolvesTo('10.0.0.5', '93.184.216.34', '127.0.0.1');

    const { error, addresses } = await lookup('mixed.example', { all: true });

    expect(error).toBeNull();
    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuses a name whose every address is somewhere inside', async () => {
    // What DNS rebinding looks like once the record has flipped.
    resolvesTo('10.0.0.5', '169.254.169.254');

    const { error, addresses } = await lookup('rebound.example', { all: true });

    expect(error).toBeInstanceOf(BlockedAddressError);
    expect(error?.message).toContain('10.0.0.5');
    expect(error?.message).toContain('169.254.169.254');
    expect(addresses).toBe('');
  });

  it('always asks the resolver for every address, whatever the caller wanted', async () => {
    // Taking the first answer would let a private address hide behind a
    // public one, or the reverse.
    resolvesTo('93.184.216.34');

    await lookup('example.com', {});

    expect(lookupMock).toHaveBeenCalledWith(
      'example.com',
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function)
    );
  });

  it('passes a resolver failure through as itself', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    lookupMock.mockImplementation((_hostname, _options, callback) => callback(failure, []));

    const { error } = await lookup('nowhere.invalid');

    expect(error).toBe(failure);
  });
});
