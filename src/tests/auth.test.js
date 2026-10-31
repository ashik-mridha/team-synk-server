import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, SESSION_COOKIE, sessionCookieOf, startTestApp } from './helpers.js';

const credentials = { name: 'Rahim Uddin', email: 'rahim@example.com', password: 'Passw0rd123' };

let ctx;
let app;

beforeAll(async () => {
  ctx = await startTestApp();
  app = ctx.app;
});

afterAll(() => ctx.stop());

beforeEach(() => ctx.reset());

const post = (path, body, cookie) => {
  const req = request(app).post(path).set('Origin', ORIGIN);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};

const signUp = (overrides = {}) =>
  post('/api/auth/sign-up/email', { ...credentials, ...overrides });
const signIn = (overrides = {}) =>
  post('/api/auth/sign-in/email', {
    email: credentials.email,
    password: credentials.password,
    ...overrides,
  });

describe('sign up', () => {
  it('creates a user, signs in and sets an httpOnly session cookie', async () => {
    const res = await signUp();

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: credentials.name, email: credentials.email });
    expect(JSON.stringify(res.body)).not.toContain(credentials.password);

    const cookie = res.headers['set-cookie'].find((c) => c.includes(SESSION_COOKIE));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('stores the password hashed, never in plain text', async () => {
    await signUp();

    const account = await ctx.db.collection('account').findOne({});
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(credentials.password);
  });

  it('rejects a duplicate email', async () => {
    await signUp();
    const res = await signUp({ email: 'RAHIM@example.com' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toMatch(/USER_ALREADY_EXISTS/);
  });

  it('rejects a password without a number', async () => {
    const res = await signUp({ password: 'onlyletters' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/number/i);
  });

  it('rejects a too-short name', async () => {
    const res = await signUp({ name: 'R' });

    expect(res.status).toBe(400);
  });
});

describe('sign in', () => {
  beforeEach(async () => {
    await signUp();
  });

  it('signs in with valid credentials', async () => {
    const res = await signIn();

    expect(res.status).toBe(200);
    expect(sessionCookieOf(res)).toContain(SESSION_COOKIE);
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const wrongPassword = await signIn({ password: 'WrongPass123' });
    const unknownEmail = await signIn({ email: 'nobody@example.com' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe('Invalid email or password');
    expect(unknownEmail.body.message).toBe('Invalid email or password');
  });
});

describe('protected routes', () => {
  it('rejects GET /api/v1/me without a session', async () => {
    const res = await request(app).get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('Cookie', `${SESSION_COOKIE}=forged.value`);

    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid session', async () => {
    const cookie = sessionCookieOf(await signUp());
    const res = await request(app).get('/api/v1/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user.password).toBeUndefined();
  });
});

describe('sign out', () => {
  it('invalidates the session', async () => {
    const cookie = sessionCookieOf(await signUp());

    expect((await post('/api/auth/sign-out', {}, cookie)).status).toBe(200);
    expect((await request(app).get('/api/v1/me').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('profile and password', () => {
  it('updates the profile name', async () => {
    const cookie = sessionCookieOf(await signUp());
    const res = await post('/api/auth/update-user', { name: 'Rahim U.' }, cookie);

    expect(res.status).toBe(200);
    const me = await request(app).get('/api/v1/me').set('Cookie', cookie);
    expect(me.body.data.user.name).toBe('Rahim U.');
  });

  it('changes the password, revoking other sessions but keeping the current one', async () => {
    const currentCookie = sessionCookieOf(await signUp());
    const otherCookie = sessionCookieOf(await signIn());

    const res = await post(
      '/api/auth/change-password',
      {
        currentPassword: credentials.password,
        newPassword: 'NewPassw0rd456',
        revokeOtherSessions: true,
      },
      currentCookie,
    );
    expect(res.status).toBe(200);

    const stillCurrent = await request(app).get('/api/v1/me').set('Cookie', sessionCookieOf(res));
    expect(stillCurrent.status).toBe(200);
    expect((await request(app).get('/api/v1/me').set('Cookie', otherCookie)).status).toBe(401);
    expect((await signIn({ password: 'NewPassw0rd456' })).status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const cookie = sessionCookieOf(await signUp());
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 'WrongPass123', newPassword: 'NewPassw0rd456' },
      cookie,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
  });
});

describe('global role', () => {
  it('defaults to "user" and ignores a role sent by the client', async () => {
    await signUp({ role: 'admin' });

    const doc = await ctx.db.collection('user').findOne({ email: credentials.email });
    expect(doc?.role ?? 'user').toBe('user');
  });

  it('promotes SUPER_ADMIN_EMAIL to admin on sign-up', async () => {
    await signUp({ email: 'boss@example.com' });

    const doc = await ctx.db.collection('user').findOne({ email: 'boss@example.com' });
    expect(doc.role).toBe('admin');
  });
});

describe('database', () => {
  it('creates every collection up front in the team-sync database', async () => {
    const names = (await ctx.db.listCollections({}, { nameOnly: true }).toArray()).map(
      (c) => c.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        'user',
        'session',
        'account',
        'verification',
        'workspaces',
        'projects',
        'tasks',
        'comments',
        'activities',
        'notifications',
        'invites',
      ]),
    );
  });
});
