/**
 * The provider and model that answer on any install, with no credential and no
 * signup: Kilo Gateway's free router. Kilo documents unauthenticated access to
 * its `:free` models (rate-limited to 200 requests/hour per IP), so an account
 * without a Kilo connection reaches it with no Authorization header at all —
 * see `anonymousFreeModels` in the Kilo registry entry and the anonymous branch
 * in `getProviderCredentials`. Unlike the Duck.ai and Quillbot web sessions it
 * also calls tools, which the chat's plugins depend on.
 *
 * It replaced OpenCode Free (`oc/big-pickle`), which began answering every call
 * from outside the OpenCode app with `403 FreeTierError`.
 *
 * Three separate places have to agree on the answer to "what works out of the
 * box?": the chat's first-run model, the gateway's last-resort fallback, and
 * the routing classifier. Hard-coding the id in each one is how they drift, so
 * they all read it from here.
 *
 * The alias-qualified key is the one form that works everywhere: it is the
 * model id the chat's model list produces, the `modelKey` the smart-routing
 * profiles carry, and a valid model string on the public gateway.
 */
export const FREE_DEFAULT_PROVIDER_ID = "kilo-gateway";
export const FREE_DEFAULT_PROVIDER_ALIAS = "kgw";
export const FREE_DEFAULT_MODEL = "kilo-auto/free";
export const FREE_DEFAULT_MODEL_KEY = `${FREE_DEFAULT_PROVIDER_ALIAS}/${FREE_DEFAULT_MODEL}`;

/** True for either spelling of the free provider, since callers see both. */
export function isFreeDefaultProvider(provider: string): boolean {
  return provider === FREE_DEFAULT_PROVIDER_ID || provider === FREE_DEFAULT_PROVIDER_ALIAS;
}
