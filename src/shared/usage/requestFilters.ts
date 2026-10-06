/**
 * Pseudo-provider of the Requests list filter: requests the gateway answered
 * through a ModelHub combo / custom model (`meta.routing.combo`), whatever the
 * upstream provider turned out to be. Not a real `usageHistory.provider` value.
 */
export const MODELHUB_PROVIDER = "__modelhub__";
