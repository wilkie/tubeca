import { jest } from '@jest/globals';
import dns from 'node:dns';
import { createCachedLookup, dnsCache } from '../index';

const lookup = createCachedLookup('Test');

/** The callback form dns.lookup uses, as a promise. */
function resolve(hostname: string, all = false): Promise<unknown> {
  return new Promise((done, fail) => {
    lookup(hostname, { all }, (err, address) => (err ? fail(err) : done(address)));
  });
}

beforeEach(() => {
  dnsCache.clear();
  jest.restoreAllMocks();
});

describe('the scraper DNS lookup', () => {
  it('resolves with c-ares rather than getaddrinfo', async () => {
    const resolve4 = jest
      .spyOn(dns, 'resolve4')
      .mockImplementation(((_host: string, cb: (e: null, a: string[]) => void) =>
        cb(null, ['93.184.216.34'])) as never);
    const getaddrinfo = jest.spyOn(dns, 'lookup');

    expect(await resolve('api.example.com')).toBe('93.184.216.34');
    expect(resolve4).toHaveBeenCalled();
    expect(getaddrinfo).not.toHaveBeenCalled();
  });

  it('answers the second time without asking again', async () => {
    const resolve4 = jest
      .spyOn(dns, 'resolve4')
      .mockImplementation(((_host: string, cb: (e: null, a: string[]) => void) =>
        cb(null, ['93.184.216.34'])) as never);

    await resolve('api.example.com');
    await resolve('api.example.com');

    expect(resolve4).toHaveBeenCalledTimes(1);
  });

  it('takes the first address when several come back', async () => {
    jest.spyOn(dns, 'resolve4').mockImplementation(((_host: string, cb: (e: null, a: string[]) => void) =>
      cb(null, ['1.1.1.1', '2.2.2.2'])) as never);

    expect(await resolve('api.example.com')).toBe('1.1.1.1');
  });

  it('answers in the shape undici asked for', async () => {
    jest.spyOn(dns, 'resolve4').mockImplementation(((_host: string, cb: (e: null, a: string[]) => void) =>
      cb(null, ['93.184.216.34'])) as never);

    expect(await resolve('api.example.com', true)).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('falls back to getaddrinfo for a name c-ares cannot see, such as one in /etc/hosts', async () => {
    jest.spyOn(dns, 'resolve4').mockImplementation(((_host: string, cb: (e: Error) => void) =>
      cb(new Error('ENOTFOUND'))) as never);
    const getaddrinfo = jest
      .spyOn(dns, 'lookup')
      .mockImplementation(((_host: string, _opts: unknown, cb: (e: null, a: string) => void) =>
        cb(null, '127.0.0.1')) as never);

    expect(await resolve('tubeca.local')).toBe('127.0.0.1');
    expect(getaddrinfo).toHaveBeenCalled();
  });

  it('caches what the fallback found too', async () => {
    jest.spyOn(dns, 'resolve4').mockImplementation(((_host: string, cb: (e: Error) => void) =>
      cb(new Error('ENOTFOUND'))) as never);
    const getaddrinfo = jest
      .spyOn(dns, 'lookup')
      .mockImplementation(((_host: string, _opts: unknown, cb: (e: null, a: string) => void) =>
        cb(null, '127.0.0.1')) as never);

    await resolve('tubeca.local');
    await resolve('tubeca.local');

    expect(getaddrinfo).toHaveBeenCalledTimes(1);
  });

  it('reports a name nothing can resolve', async () => {
    jest.spyOn(dns, 'resolve4').mockImplementation(((_host: string, cb: (e: Error) => void) =>
      cb(new Error('ENOTFOUND'))) as never);
    jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, _opts: unknown, cb: (e: Error) => void) =>
      cb(new Error('ENOTFOUND'))) as never);

    await expect(resolve('nowhere.invalid')).rejects.toThrow('ENOTFOUND');
  });

  it('forgets an address once its time is up', async () => {
    const resolve4 = jest
      .spyOn(dns, 'resolve4')
      .mockImplementation(((_host: string, cb: (e: null, a: string[]) => void) =>
        cb(null, ['93.184.216.34'])) as never);
    await resolve('api.example.com');

    dnsCache.set('api.example.com', { address: '93.184.216.34', expires: Date.now() - 1 });
    await resolve('api.example.com');

    expect(resolve4).toHaveBeenCalledTimes(2);
  });
});
