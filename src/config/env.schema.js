import { z } from 'zod';

/** Treats an empty string (e.g. `SUPER_ADMIN_EMAIL=`) as "not set". */
const emptyToUndefined = (value) => (value === '' ? undefined : value);

/**
 * `CLIENT_URL` accepts one origin or a comma-separated list (production + preview domains).
 * Each entry must be a bare origin: no path, no trailing slash needed (it is stripped).
 */
const originList = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const origins = [];
    for (const entry of value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)) {
      let url;
      try {
        url = new URL(entry);
      } catch {
        ctx.addIssue({ code: 'custom', message: `"${entry}" is not a valid URL` });
        return z.NEVER;
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        (url.pathname !== '/' && url.pathname !== '')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `"${entry}" must be an origin like https://app.example.com (no path)`,
        });
        return z.NEVER;
      }
      origins.push(url.origin);
    }
    if (origins.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must contain at least one origin' });
      return z.NEVER;
    }
    return [...new Set(origins)];
  });

const envSchema = z
  .object({
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
    /** Allowed browser origin(s), comma separated. The first one is used for invite links. */
    CLIENT_URL: originList,
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Public URL of this API (Better Auth base URL). Required in production. */
    BETTER_AUTH_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    /** This account gets the global `admin` role on sign-up or at server start. */
    SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    /** Number of reverse proxies in front of the API (0 = none). Needed for correct client IPs. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    /** Parent domain for the session cookie when app and API are subdomains (e.g. example.com). */
    COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().min(3).optional()),
    /** General API budget per IP per 15 minutes (auth endpoints have their own, stricter limit). */
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && !data.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'is required in production (the public https URL of this API)',
      });
    }
  });

/**
 * Validates an environment object. Returns `{ ok: true, data }` or `{ ok: false, errors }` where
 * every error names the variable, so a failed deploy log says exactly what to set.
 */
export function parseEnv(source) {
  const result = envSchema.safeParse(source);
  if (result.success) {
    const { CLIENT_URL: origins, ...rest } = result.data;
    const port = rest.PORT;
    return {
      ok: true,
      data: {
        ...rest,
        CLIENT_ORIGINS: origins,
        CLIENT_URL: origins[0],
        SUPER_ADMIN_EMAIL: rest.SUPER_ADMIN_EMAIL?.toLowerCase(),
        BETTER_AUTH_URL: rest.BETTER_AUTH_URL?.replace(/\/$/, '') ?? `http://localhost:${port}`,
      },
    };
  }

  const errors = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? 'environment');
    const missing = issue.code === 'invalid_type' && source[name] === undefined;
    return `${name}: ${missing ? 'is not set' : issue.message}`;
  });
  return { ok: false, errors };
}
