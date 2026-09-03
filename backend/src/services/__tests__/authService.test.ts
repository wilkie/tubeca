import { AuthService, resolveJwtSecret } from '../authService';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('password hashing', () => {
    it('hashes a password', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('produces different hashes for the same password', async () => {
      const password = 'testPassword123';
      const hash1 = await authService.hashPassword(password);
      const hash2 = await authService.hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('verifies a correct password', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });
  });

  describe('JWT tokens', () => {
    const testPayload = {
      userId: 'user-123',
      name: 'testuser',
      role: 'Admin' as const,
    };

    it('generates a token', () => {
      const token = authService.generateToken(testPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('verifies a valid token', () => {
      const token = authService.generateToken(testPayload);
      const decoded = authService.verifyToken(token);

      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.name).toBe(testPayload.name);
      expect(decoded.role).toBe(testPayload.role);
    });

    it('throws on invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => authService.verifyToken(invalidToken)).toThrow();
    });

    it('throws on tampered token', () => {
      const token = authService.generateToken(testPayload);
      const tamperedToken = token.slice(0, -5) + 'XXXXX';

      expect(() => authService.verifyToken(tamperedToken)).toThrow();
    });

    it('includes expiration in token', () => {
      const token = authService.generateToken(testPayload);
      const decoded = authService.verifyToken(token);

      expect(decoded).toHaveProperty('exp');
      expect(decoded).toHaveProperty('iat');
    });
  });
});

describe('resolveJwtSecret', () => {
  const PLACEHOLDER = 'change-this-to-a-secure-random-string';
  const originalWarn = console.warn;
  let warnings: string[] = [];

  beforeEach(() => {
    warnings = [];
    console.warn = (message: string) => {
      warnings.push(message);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('returns the configured secret', () => {
    expect(resolveJwtSecret({ JWT_SECRET: 'abc123', NODE_ENV: 'production' })).toBe('abc123');
    expect(warnings).toHaveLength(0);
  });

  it('throws in production when the secret is missing', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET must be set/);
  });

  it('throws in production when the secret is the .env.example placeholder', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: PLACEHOLDER })).toThrow(
      /JWT_SECRET must be set/
    );
  });

  it('throws in production when the secret is blank', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: '   ' })).toThrow();
  });

  it('falls back to a development default with a warning outside production', () => {
    const secret = resolveJwtSecret({ NODE_ENV: 'development' });
    expect(secret).toBe('dev-secret-change-in-production');
    expect(warnings).toHaveLength(1);
  });

  it('treats the placeholder as unset outside production', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'test', JWT_SECRET: PLACEHOLDER })).toBe(
      'dev-secret-change-in-production'
    );
  });
});
