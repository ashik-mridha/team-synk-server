import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.schema.js';

const valid = {
  MONGODB_URI: 'mongodb+srv://user:SuperSecretPw@cluster.example.net/team-sync',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  CLIENT_URL: 'https://app.example.com',
};

describe('parseEnv', () => {
  it('names every missing variable and never echoes a value', () => {
    const result = parseEnv({ BETTER_AUTH_SECRET: 'too-short-secret-value' });

    expect(result.ok).toBe(false);
    const text = result.errors.join('\n');
    expect(text).toMatch(/MONGODB_URI: is not set/);
    expect(text).toMatch(/CLIENT_URL: is not set/);
    expect(text).toMatch(/BETTER_AUTH_SECRET: must be at least 32 characters/);
    expect(text).not.toContain('too-short-secret-value');
  });

  it('applies defaults, including the team-sync database name', () => {
    const { ok, data } = parseEnv(valid);

    expect(ok).toBe(true);
    expect(data.DB_NAME).toBe('team-sync');
    expect(data.COOKIE_SAME_SITE).toBe('lax');
    expect(data.BETTER_AUTH_URL).toBe('http://localhost:5000');
  });

  it('accepts a comma-separated origin list, strips trailing slashes and removes duplicates', () => {
    const { data } = parseEnv({
      ...valid,
      CLIENT_URL: 'https://app.example.com/, https://preview.vercel.app,https://app.example.com',
    });

    expect(data.CLIENT_ORIGINS).toEqual(['https://app.example.com', 'https://preview.vercel.app']);
    expect(data.CLIENT_URL).toBe('https://app.example.com');
  });

  it('rejects an origin that has a path or is not a URL', () => {
    const withPath = parseEnv({ ...valid, CLIENT_URL: 'https://app.example.com/dashboard' });
    const notUrl = parseEnv({ ...valid, CLIENT_URL: 'not a url' });

    expect(withPath.errors[0]).toMatch(/^CLIENT_URL: .*no path/);
    expect(notUrl.errors[0]).toMatch(/^CLIENT_URL/);
  });

  it('requires BETTER_AUTH_URL in production only', () => {
    const production = parseEnv({ ...valid, NODE_ENV: 'production' });
    const withUrl = parseEnv({
      ...valid,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com/',
    });

    expect(production.ok).toBe(false);
    expect(production.errors.join()).toMatch(/BETTER_AUTH_URL: is required in production/);
    expect(withUrl.data.BETTER_AUTH_URL).toBe('https://api.example.com');
  });

  it('treats empty optional variables as unset', () => {
    const { ok, data } = parseEnv({ ...valid, SUPER_ADMIN_EMAIL: '', COOKIE_DOMAIN: '' });

    expect(ok).toBe(true);
    expect(data.SUPER_ADMIN_EMAIL).toBeUndefined();
    expect(data.COOKIE_DOMAIN).toBeUndefined();
  });
});
