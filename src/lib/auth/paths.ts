/**
 * Where the auth screens live. Isomorphic on purpose: the middleware, the
 * server and the client header all need to agree on the sign-in URL, and
 * `lib/auth/server.ts` is `server-only`.
 */
export const SIGN_IN_PATH: string = "/auth/sign-in";
export const ACCOUNT_PATH: string = "/auth/settings";
