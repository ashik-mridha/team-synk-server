import http from 'http';
import { app } from './app.js';
import { closeAuthDb } from './config/auth.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env, isProd } from './config/env.js';
import { initSockets } from './sockets/index.js';
import { logger } from './utils/logger.js';

const httpServer = http.createServer(app);
const io = initSockets(httpServer);

async function start() {
  // Config (never secrets), so a deploy log proves what the process is actually using.
  logger.info(
    {
      env: env.NODE_ENV,
      port: env.PORT,
      database: env.DB_NAME,
      clientOrigins: env.CLIENT_ORIGINS,
      betterAuthUrl: env.BETTER_AUTH_URL,
      cookieSameSite: env.COOKIE_SAME_SITE,
      cookieSecure: isProd || env.COOKIE_SAME_SITE === 'none',
      socketCorsOrigins: env.CLIENT_ORIGINS,
      cookieDomain: env.COOKIE_DOMAIN ?? null,
      trustProxy: env.TRUST_PROXY,
      transactions: env.MONGODB_USE_TRANSACTIONS,
    },
    'TeamSync API configuration',
  );

  try {
    await connectDb();
  } catch (err) {
    if (isProd) {
      // A production API without its database is just a slow way to fail: stop so the host
      // marks the deploy as failed and shows the reason.
      logger.fatal({ err }, 'MongoDB connection failed, exiting');
      process.exit(1);
    }
    logger.error({ err }, 'MongoDB connection failed, API will run without a database');
  }

  httpServer.listen(env.PORT, '0.0.0.0', () =>
    logger.info(`Server listening on port ${env.PORT} (health: /api/v1/health)`),
  );
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  await io.close();
  await disconnectDb();
  await closeAuthDb();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start();
