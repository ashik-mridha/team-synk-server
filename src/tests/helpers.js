import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

export const ORIGIN = 'http://localhost:3000';
export const DB_NAME = 'team-sync';
export const SESSION_COOKIE = 'better-auth.session_token';
export const PASSWORD = 'Passw0rd123';

/**
 * Starts an in-memory MongoDB, then imports the app (config modules read env at import time),
 * connects Mongoose and creates collections/indexes exactly as the real server does.
 */
export async function startTestApp() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  const client = new MongoClient(process.env.MONGODB_URI);
  const { app } = await import('../app.js');
  const { closeAuthDb } = await import('../config/auth.js');
  const { connectDb, disconnectDb } = await import('../config/db.js');
  await connectDb();

  return {
    app,
    db: client.db(DB_NAME),
    async reset() {
      const collections = await client.db(DB_NAME).collections();
      await Promise.all(collections.map((c) => c.deleteMany({})));
    },
    async stop() {
      await disconnectDb();
      await closeAuthDb();
      await client.close();
      await mongo.stop();
    },
  };
}

export function sessionCookieOf(res) {
  const header = res.headers['set-cookie']?.find((c) => c.includes(SESSION_COOKIE));
  if (!header) throw new Error('session cookie not set');
  return header.split(';')[0];
}

/** Registers a user through Better Auth and returns their session cookie. */
export async function signUp(app, name, email, extra = {}) {
  const res = await request(app)
    .post('/api/auth/sign-up/email')
    .set('Origin', ORIGIN)
    .send({ name, email, password: PASSWORD, ...extra });
  return { res, cookie: res.status === 200 ? sessionCookieOf(res) : null };
}

/** Calls the REST API as the user owning `cookie`. */
export function api(app, method, path, cookie, body) {
  const req = request(app)[method](`/api/v1${path}`).set('Cookie', cookie);
  return body ? req.send(body) : req;
}
