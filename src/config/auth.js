import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { MongoClient } from 'mongodb';
import { nameSchema, passwordSchema } from '../validators/auth.validators.js';
import { GlobalRole } from './constants.js';
import { env, isProd } from './env.js';

// Better Auth uses the native MongoDB driver; app data uses Mongoose on its own connection.
// Both are pinned to the same database name (env.DB_NAME) instead of whatever the URI defaults to.
const client = new MongoClient(env.MONGODB_URI);
export const authDb = client.db(env.DB_NAME);

/** Set by app.js from Express's req.ip so rate limiting is per client, not per proxy. */
export const CLIENT_IP_HEADER = 'x-client-ip';

const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const strictRule = { window: RATE_LIMIT_WINDOW_SECONDS, max: env.AUTH_RATE_LIMIT_MAX };

/** Enforces the rules Better Auth does not (name length, password letter + number). */
const validateInput = createAuthMiddleware(async (ctx) => {
  const body = ctx.body ?? {};
  const checks = {
    '/sign-up/email': [
      ['name', nameSchema],
      ['password', passwordSchema],
    ],
    '/update-user': body.name === undefined ? [] : [['name', nameSchema]],
    '/change-password': [['newPassword', passwordSchema]],
  }[ctx.path];

  for (const [field, schema] of checks ?? []) {
    const result = schema.safeParse(body[field]);
    if (!result.success) {
      throw new APIError('BAD_REQUEST', { message: result.error.issues[0].message });
    }
  }
});

export const auth = betterAuth({
  appName: 'TeamSync',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.CLIENT_URL],
  database: mongodbAdapter(authDb, env.MONGODB_USE_TRANSACTIONS ? { client } : undefined),
  user: {
    additionalFields: {
      // `input: false` means clients can never set this through sign-up or update-user.
      role: {
        type: 'string',
        required: false,
        defaultValue: GlobalRole.USER,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const isSuperAdmin =
            env.SUPER_ADMIN_EMAIL && user.email?.toLowerCase() === env.SUPER_ADMIN_EMAIL;
          return { data: { ...user, role: isSuperAdmin ? GlobalRole.ADMIN : GlobalRole.USER } };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  rateLimit: {
    // Per-process memory store; switch `storage` to "database" when running several instances.
    enabled: env.NODE_ENV !== 'test',
    customRules: {
      '/sign-in/email': strictRule,
      '/sign-up/email': strictRule,
      '/get-session': false,
    },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    useSecureCookies: isProd || env.COOKIE_SAME_SITE === 'none',
    defaultCookieAttributes: { sameSite: env.COOKIE_SAME_SITE },
  },
  hooks: { before: validateInput },
});

export async function closeAuthDb() {
  await client.close();
}
