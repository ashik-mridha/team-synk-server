import { env } from './env.js';

/**
 * One CORS policy shared by Express, Better Auth (`trustedOrigins`) and Socket.io, so the three
 * can never disagree about who may call the API.
 */
export const allowedOrigins = env.CLIENT_ORIGINS;

export const corsOptions = {
  // Requests without an Origin (curl, health checks, server-to-server) are not browser CORS.
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Mutation-Id', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  // Browsers cache the preflight answer, which keeps the extra round trip off every request.
  maxAge: 600,
  optionsSuccessStatus: 204,
};
