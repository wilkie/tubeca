import { parseRole, runsApi, runsWorkers } from '../role';

describe('parseRole', () => {
  it('defaults to all and accepts the three roles case-insensitively', () => {
    expect(parseRole(undefined)).toBe('all');
    expect(parseRole('')).toBe('all');
    expect(parseRole('API')).toBe('api');
    expect(parseRole(' worker ')).toBe('worker');
  });

  it('rejects anything else loudly', () => {
    expect(() => parseRole('frontend')).toThrow(/TUBECA_ROLE/);
  });

  it('maps roles to responsibilities', () => {
    expect([runsApi('api'), runsWorkers('api')]).toEqual([true, false]);
    expect([runsApi('worker'), runsWorkers('worker')]).toEqual([false, true]);
    expect([runsApi('all'), runsWorkers('all')]).toEqual([true, true]);
  });
});
