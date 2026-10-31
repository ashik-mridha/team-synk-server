import 'dotenv/config';
import { parseEnv } from './env.schema.js';

const parsed = parseEnv(process.env);

if (!parsed.ok) {
  // Names only, never values: this lands in deploy logs.
  console.error(
    [
      'Cannot start: invalid or missing environment variables:',
      ...parsed.errors.map((line) => `  - ${line}`),
      'Set them in the hosting dashboard (Render: Environment tab) or in server/.env.',
    ].join('\n'),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
