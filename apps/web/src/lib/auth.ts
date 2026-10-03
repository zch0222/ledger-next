import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { database } from '@ledger/db/index';
import * as schema from '@ledger/db/schema';
import { authRateLimitStorage } from '@ledger/domain/rate-limit';

let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  const baseURL = process.env.APP_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!baseURL || !secret || secret.length < 32) {
    throw new Error('APP_URL and BETTER_AUTH_SECRET (32+ characters) are required');
  }
  return betterAuth({
    appName: 'Ledger Next',
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    database: drizzleAdapter(database(), { provider: 'mysql', schema, transaction: true }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { database: { generateId: 'uuid' }, useSecureCookies: new URL(baseURL).protocol === 'https:' },
    // Shared through Redis so every web process (cluster mode) enforces the same per-client budget.
    rateLimit: { enabled: true, window: 60, max: 60, customStorage: authRateLimitStorage() },
  });
}
export function auth() {
  return (instance ??= createAuth());
}
