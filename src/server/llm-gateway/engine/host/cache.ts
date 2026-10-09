// Host adapter — a small TTL memo for engine reads that sit on the hot path.
// The class knows nothing about accounts: the caller's key must carry the tenant.
export { TtlMemo } from "@/lib/ttlMemo";
