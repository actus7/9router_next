// Host adapter — usage & request-detail persistence (SQLite-backed).
//
// This is the ONLY sanctioned way for engine code to record usage. Do not
// import @/lib/usageDb directly from engine modules.
//
// Semantics (PLANOMIGRACAOOPENSSE.md, FASE 4):
// - trackPendingRequest / appendRequestLog / saveRequestDetail /
//   saveRequestUsage: best-effort — callers already swallow errors where the
//   request must not fail; usage accounting is at-least-once per call.
export {
  trackPendingRequest,
  appendRequestLog,
  saveRequestDetail,
  saveRequestUsage,
} from "@/lib/usageDb";
