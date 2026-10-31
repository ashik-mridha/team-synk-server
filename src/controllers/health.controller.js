import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authDb } from '../config/auth.js';
import { sendError, sendSuccess } from '../utils/response.js';
export const getHealth = asyncHandler(async (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

/** Readiness: the process is up AND both database clients answer a ping. */
export const getReady = asyncHandler(async (_req, res) => {
  try {
    await Promise.all([mongoose.connection.db.admin().ping(), authDb.command({ ping: 1 })]);
  } catch {
    return sendError(res, 503, 'NOT_READY', 'Database is not reachable');
  }
  sendSuccess(res, { status: 'ready', database: mongoose.connection.name });
});
