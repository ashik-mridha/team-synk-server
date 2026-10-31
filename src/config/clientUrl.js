import { env } from './env.js';

/** Origin of the web app without a trailing slash (used to build invite links). */
export const CLIENT_URL = env.CLIENT_URL.replace(/\/$/, '');
