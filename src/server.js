
import http from 'http';
import { app } from './app.js';
import { closeAuthDb } from './config/auth.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { initSockets } from './sockets/index.js';
import { logger } from './utils/logger.js';

const httpServer = http.createServer(app);
const io = initSockets(httpServer);
async function start() {
  try {
    await connectDb();
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed, API will run without a database');
  }
  httpServer.listen(env.PORT, () =>
    logger.info(`Server listening on http://localhost:${env.PORT}`),
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
