/**
 * The provider and model that answer on any install, with no credential and no
 * signup. OpenCode Free is a `noAuth` provider, so the routing inventory keeps
 * it available even when the operator has configured nothing at all — see the
 * unconditional `noAuth` branch in
 * `engine/services/smart-routing/inventory.ts`.
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
export const FREE_DEFAULT_PROVIDER_ID = "opencode";
export const FREE_DEFAULT_PROVIDER_ALIAS = "oc";
export const FREE_DEFAULT_MODEL = "big-pickle";
export const FREE_DEFAULT_MODEL_KEY = `${FREE_DEFAULT_PROVIDER_ALIAS}/${FREE_DEFAULT_MODEL}`;

/** True for either spelling of the free provider, since callers see both. */
export function isFreeDefaultProvider(provider: string): boolean {
  return provider === FREE_DEFAULT_PROVIDER_ID || provider === FREE_DEFAULT_PROVIDER_ALIAS;
}
