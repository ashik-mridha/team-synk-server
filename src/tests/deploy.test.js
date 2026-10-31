import http from 'http';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, signUp, startTestApp } from './helpers.js';

// Two allowed origins, as in production (main domain + a preview domain).
const MAIN = 'http://localhost:3000';
const PREVIEW = 'https://team-synk-git-preview.vercel.app';
const EVIL = 'https://evil.example';

let ctx;
let server;
let url;
let cookie;
const sockets = [];

const open = (auth) => {
  const socket = connect(url, {
    transports: ['websocket'],
    extraHeaders: { Origin: PREVIEW },
    auth,
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
};

beforeAll(async () => {
  process.env.CLIENT_URL = `${MAIN},${PREVIEW}/`;
  ctx = await startTestApp();
  const { initSockets } = await import('../sockets/index.js');
  server = http.createServer(ctx.app);
  initSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await ctx.stop();
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

beforeEach(async () => {
  await ctx.reset();
  cookie = (await signUp(ctx.app, 'Olivia Owner', 'owner@example.com')).cookie;
});

describe('CORS with several allowed origins', () => {
  it('answers a preflight for every allowed origin with credentials', async () => {
    for (const origin of [MAIN, PREVIEW]) {
      const res = await request(ctx.app)
        .options('/api/auth/sign-in/email')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
      expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
    }
  });

  it('gives an unknown origin no CORS headers, on preflight and on a real request', async () => {
    const preflight = await request(ctx.app)
      .options('/api/v1/me')
      .set('Origin', EVIL)
      .set('Access-Control-Request-Method', 'GET');
    const real = await request(ctx.app).get('/api/v1/health').set('Origin', EVIL);

    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('puts CORS headers on error responses too (auth failure, 401, 404)', async () => {
    const responses = await Promise.all([
      request(ctx.app)
        .post('/api/auth/sign-in/email')
        .set('Origin', PREVIEW)
        .send({ email: 'nobody@example.com', password: 'WrongPass123' }),
      request(ctx.app).get('/api/v1/me').set('Origin', PREVIEW),
      request(ctx.app).get('/api/v1/does-not-exist').set('Origin', PREVIEW),
    ]);

    for (const res of responses) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['access-control-allow-origin']).toBe(PREVIEW);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('hands Better Auth the same origin list (its own origin check is off under NODE_ENV=test)', async () => {
    const { auth } = await import('../config/auth.js');
    const { allowedOrigins } = await import('../config/cors.js');
    const context = await auth.$context;

    expect(allowedOrigins).toEqual([MAIN, PREVIEW]);
    expect(context.trustedOrigins).toEqual(expect.arrayContaining(allowedOrigins));
    expect(context.trustedOrigins).not.toContain(EVIL);
  });
});

describe('socket tickets', () => {
  const ticketFor = async (who = cookie) =>
    (await api(ctx.app, 'post', '/socket-ticket', who)).body.data.ticket;

  it('requires a session to issue a ticket', async () => {
    expect((await request(ctx.app).post('/api/v1/socket-ticket')).status).toBe(401);
  });

  it('stores only a hash of the ticket', async () => {
    const ticket = await ticketFor();
    const stored = await ctx.db.collection('sockettickets').findOne({});

    expect(stored.tokenHash).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(ticket);
  });

  it('authenticates a socket that sends no cookie', async () => {
    const socket = await open({ ticket: await ticketFor() });

    expect(socket.connected).toBe(true);
  });

  it('is single use', async () => {
    const ticket = await ticketFor();
    await open({ ticket });

    await expect(open({ ticket })).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects an expired ticket', async () => {
    const ticket = await ticketFor();
    await ctx.db.collection('sockettickets').updateMany({}, { $set: { expiresAt: new Date(0) } });

    await expect(open({ ticket })).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects missing, forged and non-string tickets', async () => {
    await expect(open({})).rejects.toThrow('UNAUTHORIZED');
    await expect(open({ ticket: 'forged' })).rejects.toThrow('UNAUTHORIZED');
    await expect(open({ ticket: { $ne: null } })).rejects.toThrow('UNAUTHORIZED');
  });

  it('ignores a user id sent by the client: identity is whoever the ticket was issued to', async () => {
    const workspace = (await api(ctx.app, 'post', '/workspaces', cookie, { name: 'Phoenix' })).body
      .data.workspace;
    const project = (
      await api(ctx.app, 'post', `/workspaces/${workspace.id}/projects`, cookie, { name: 'Web' })
    ).body.data.project;
    const outsider = (await signUp(ctx.app, 'Otto Outsider', 'otto@example.com')).cookie;

    const socket = await open({ ticket: await ticketFor(outsider), userId: workspace.ownerId });
    const ack = await new Promise((resolve) => socket.emit('project:join', project.id, resolve));

    expect(ack).toMatchObject({ ok: false, error: 'FORBIDDEN' });
  });

  it('still accepts the session cookie when it does reach the socket host', async () => {
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    sockets.push(socket);

    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    expect(socket.connected).toBe(true);
  });
});
