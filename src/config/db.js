import mongoose from 'mongoose';
import { appModels } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { authDb } from './auth.js';
import { AUTH_COLLECTIONS, GlobalRole } from './constants.js';
import { env } from './env.js';

export async function connectDb() {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  // dbName is explicit so Mongoose never falls back to the driver default ("test").
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_NAME,
    serverSelectionTimeoutMS: 5000,
  });
  logger.info(
    { mongoose: mongoose.connection.name, betterAuth: authDb.databaseName },
    `MongoDB connected, using database "${mongoose.connection.name}"`,
  );
  // Fail fast if the two MongoDB clients ever point at different databases.
  if (mongoose.connection.name !== authDb.databaseName) {
    throw new Error(
      `Database mismatch: Mongoose uses "${mongoose.connection.name}" but Better Auth uses "${authDb.databaseName}"`,
    );
  }
  await ensureDatabase();
}

async function existingCollections(db) {
  return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
}

/**
 * Creates every collection and index up front so they are visible in Compass/Atlas
 * even while empty, and promotes SUPER_ADMIN_EMAIL if configured.
 */
export async function ensureDatabase() {
  const authExisting = await existingCollections(authDb);
  for (const name of AUTH_COLLECTIONS) {
    if (!authExisting.has(name)) await authDb.createCollection(name);
  }
  await Promise.all([
    authDb.collection('user').createIndex({ email: 1 }, { unique: true }),
    authDb.collection('session').createIndex({ token: 1 }, { unique: true }),
    authDb.collection('session').createIndex({ userId: 1 }),
    authDb.collection('account').createIndex({ userId: 1 }),
    authDb.collection('verification').createIndex({ identifier: 1 }),
  ]);

  const existing = await existingCollections(mongoose.connection.db);
  for (const model of appModels) {
    if (!existing.has(model.collection.collectionName)) await model.createCollection();
  }
  await Promise.all(appModels.map((model) => model.syncIndexes()));

  if (env.SUPER_ADMIN_EMAIL) {
    const result = await authDb
      .collection('user')
      .updateOne({ email: env.SUPER_ADMIN_EMAIL }, { $set: { role: GlobalRole.ADMIN } });
    if (result.matchedCount) logger.info(`Super admin ensured: ${env.SUPER_ADMIN_EMAIL}`);
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
