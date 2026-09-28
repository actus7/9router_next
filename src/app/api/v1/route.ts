// `./models/route` already exports its GET wrapped in `gatewayRoute`; wrapping
// it again here counted the rate limit and resolved the key twice per request.
export { GET, OPTIONS } from "./models/route";
