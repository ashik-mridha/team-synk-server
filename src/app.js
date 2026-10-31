import compression from 'compression';
import cors from 'cors';
import { randomUUID } from 'crypto';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { auth, CLIENT_IP_HEADER } from './config/auth.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { apiLimiter } from './middlewares/rateLimiter.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(compression());
// Every request gets an id (echoed in x-request-id and in 500 responses) so a user report can be traced.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    autoLogging: {
      ignore: (req) => req.url.startsWith('/api/v1/health') || req.url === '/api/v1/ready',
    },
  }),
);

// Better Auth must be mounted before express.json(); it reads the raw request stream itself.
app.use('/api/auth', (req, _res, next) => {
  req.headers[CLIENT_IP_HEADER] = req.ip;
  next();
});
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', apiLimiter, apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
