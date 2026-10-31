/**
 * Smoke test for a deployed API: health, CORS, auth cookie flags, session, and the Socket.io
 * handshake. It creates one throwaway user (deploycheck-<time>@example.com).
 *
 * Usage:
 *   npm run check:deploy -- <apiUrl> <clientOrigin> [--via-client]
 *
 *   apiUrl        the API's public URL (Render), e.g. https://teamsync-server.onrender.com
 *   clientOrigin  the web app's origin, e.g. https://team-synk-omega.vercel.app
 *   --via-client  send auth and REST calls through the web app (its /api rewrites), exactly like
 *                 the browser does when the API is proxied. CORS and the socket always hit apiUrl.
 */
import { randomBytes } from 'crypto';
import { io } from 'socket.io-client';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const viaClient = process.argv.includes('--via-client');
const [apiArg, originArg] = args;

if (!apiArg || !originArg) {
  console.error('Usage: npm run check:deploy -- <apiUrl> <clientOrigin> [--via-client]');
  process.exit(2);
}

const api = apiArg.replace(/\/$/, '');
const origin = new URL(originArg).origin;
const base = viaClient ? origin : api;
const TIMEOUT = 60_000; // free hosts can need a minute to wake up

let failures = 0;
const report = (ok, name, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function step(name, fn) {
  try {
    const detail = await fn();
    report(true, name, detail ?? '');
  } catch (error) {
    report(false, name, error instanceof Error ? error.message : String(error));
  }
}

const request = (url, init = {}) =>
  fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`API:    ${api}`);
console.log(`Client: ${origin}${viaClient ? '  (auth + REST via the client rewrite)' : ''}\n`);

await step('GET /api/v1/health is 200', async () => {
  const res = await request(`${api}/api/v1/health`);
  expect(
    res.status === 200,
    `status ${res.status}${res.headers.get('x-vercel-error') ? ' (a Vercel error page, not the Express API)' : ''}`,
  );
});

await step('GET /api/v1/ready is 200 and uses database team-sync', async () => {
  const res = await request(`${api}/api/v1/ready`);
  expect(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  expect(body.data?.database === 'team-sync', `database is "${body.data?.database}"`);
  return `database ${body.data.database}`;
});

await step('CORS preflight allows the client origin with credentials', async () => {
  const res = await request(`${api}/api/auth/sign-in/email`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  expect([200, 204].includes(res.status), `status ${res.status}`);
  expect(
    res.headers.get('access-control-allow-origin') === origin,
    `allow-origin is "${res.headers.get('access-control-allow-origin')}"`,
  );
  expect(
    res.headers.get('access-control-allow-credentials') === 'true',
    'allow-credentials is not "true"',
  );
  expect(
    /POST/i.test(res.headers.get('access-control-allow-methods') ?? ''),
    'POST not in allow-methods',
  );
  expect(
    /content-type/i.test(res.headers.get('access-control-allow-headers') ?? ''),
    'content-type not in allow-headers',
  );
});

await step('A real request carries Access-Control-Allow-Origin for the client', async () => {
  const res = await request(`${api}/api/v1/health`, { headers: { Origin: origin } });
  expect(
    res.headers.get('access-control-allow-origin') === origin,
    `allow-origin is "${res.headers.get('access-control-allow-origin')}"`,
  );
  expect(
    res.headers.get('access-control-allow-credentials') === 'true',
    'allow-credentials is not "true"',
  );
});

await step('An unknown origin gets no CORS headers', async () => {
  const res = await request(`${api}/api/v1/health`, {
    headers: { Origin: 'https://evil.example' },
  });
  expect(!res.headers.get('access-control-allow-origin'), 'evil.example was allowed');
});

const email = `deploycheck-${Date.now()}@example.com`;
const password = `Check-${randomBytes(6).toString('hex')}1`;
let cookie = '';

await step('Sign-up works and the session cookie is HttpOnly + Secure', async () => {
  const res = await request(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ name: 'Deploy Check', email, password }),
  });
  expect(res.status === 200, `status ${res.status}`);
  const header = res.headers.getSetCookie().find((c) => c.includes('session_token'));
  expect(header, 'no session cookie in Set-Cookie');
  cookie = header.split(';')[0];
  const flags = header.toLowerCase();
  expect(flags.includes('httponly'), 'cookie is not HttpOnly');
  if (base.startsWith('https://')) expect(flags.includes('secure'), 'cookie is not Secure');
  const sameSite = /samesite=(\w+)/i.exec(header)?.[1] ?? 'unset';
  const crossSite = new URL(base).hostname !== new URL(origin).hostname;
  if (crossSite)
    expect(sameSite.toLowerCase() === 'none', `SameSite=${sameSite} will not be sent cross-site`);
  return `SameSite=${sameSite}, ${crossSite ? 'cross-site' : 'first-party'}`;
});

await step('GET /api/auth/get-session returns the new user', async () => {
  const res = await request(`${base}/api/auth/get-session`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  expect(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  expect(body?.user?.email === email, 'session does not belong to the new user');
});

await step('GET /api/v1/me with the cookie is 200', async () => {
  const res = await request(`${base}/api/v1/me`, { headers: { Cookie: cookie, Origin: origin } });
  expect(res.status === 200, `status ${res.status}`);
});

let ticket = '';
await step('POST /api/v1/socket-ticket issues a one-time ticket', async () => {
  const res = await request(`${base}/api/v1/socket-ticket`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
  });
  expect(res.status === 200, `status ${res.status}`);
  ticket = (await res.json()).data.ticket;
  expect(ticket, 'no ticket in the response');
});

function connectSocket(auth) {
  return new Promise((resolve, reject) => {
    const socket = io(api, {
      transports: ['websocket'],
      extraHeaders: { Origin: origin },
      auth,
      reconnection: false,
      timeout: TIMEOUT,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

await step('Socket.io connects with the ticket', async () => {
  const socket = await connectSocket({ ticket });
  const transport = socket.io.engine.transport.name;
  socket.close();
  return `transport ${transport}`;
});

await step('The same ticket cannot be replayed', async () => {
  const outcome = await connectSocket({ ticket }).then(
    (s) => (s.close(), 'connected'),
    (e) => e.message,
  );
  expect(outcome === 'UNAUTHORIZED', `second use result: ${outcome}`);
});

await step('Socket.io rejects a connection without credentials', async () => {
  const outcome = await connectSocket({}).then(
    (s) => (s.close(), 'connected'),
    (e) => e.message,
  );
  expect(outcome === 'UNAUTHORIZED', `result: ${outcome}`);
});

await step('Sign-out clears the session', async () => {
  const res = await request(`${base}/api/auth/sign-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: '{}',
  });
  expect(res.status === 200, `status ${res.status}`);
});

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
console.log(`(A throwaway user ${email} remains in the database; delete it in Atlas if you like.)`);
process.exit(failures === 0 ? 0 : 1);
