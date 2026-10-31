import 'dotenv/config';
import { z } from 'zod';

/** Treats an empty string (e.g. `SUPER_ADMIN_EMAIL=`) as "not set". */
const emptyToUndefined = (value) => (value === '' ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1),
  /** The single database used by Mongoose AND Better Auth. */
  DB_NAME: z.string().min(1).default('team-sync'),
  /** Standalone MongoDB has no transactions; enable for replica sets / Atlas. */
  MONGODB_USE_TRANSACTIONS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CLIENT_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public URL of this API (Better Auth base URL). Defaults to http://localhost:PORT. */
  BETTER_AUTH_URL: z.string().url().optional(),
  /** This account gets the global `admin` role on sign-up or at server start. */
  SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  /** Number of reverse proxies in front of the API (0 = none). Needed for correct client IPs. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** General API budget per IP per 15 minutes (auth endpoints have their own, stricter limit). */
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  SUPER_ADMIN_EMAIL: parsed.data.SUPER_ADMIN_EMAIL?.toLowerCase(),
  BETTER_AUTH_URL: parsed.data.BETTER_AUTH_URL ?? `http://localhost:${parsed.data.PORT}`,
};
export const isProd = env.NODE_ENV === 'production';
