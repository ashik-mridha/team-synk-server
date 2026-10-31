import pino from 'pino';
import { env, isProd } from '../config/env.js';
export const logger = pino({
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  level: env.NODE_ENV === 'test' ? 'silent' : isProd ? 'info' : 'debug',
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
